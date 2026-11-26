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
//
// Joint friction (opts.jointFriction = μ, default JOINT_FRICTION.realistic = 0.2; DESIGN §5.1,
// DEVIATIONS §5 "Joint friction"): every joint gets a Rapier velocity motor with target 0 on each
// free axis (revolute AngX, prismatic LinX, cylindrical AngX + LinX), its maxForce limited to
// τ_f = μ·m_j·|g|·R_BORE (rotation) or F_f = μ·m_j·|g| (slide), m_j = the weight the joint carries
// (see loadMasses). Rapier's maxForce is a torque/force (measured), so a sliding joint feels
// exactly ∓τ_f / ∓F_f. Below that the joint sticks: once its relative speed falls below a
// threshold, the motor's target velocity steers it back to the coordinate where it stuck (see
// updateFriction), which cancels the solver's slow creep; it lets go when the joint has been
// pushed more than a hair away. μ = 0 adds no motor and runs none of this.
//
// Energy guard (opts.energyGuard, default on; see guardEnergy and DEVIATIONS §5): after every
// fixed step, a group of connected dynamic bodies whose energy has risen more than 1 % of its peak
// kinetic energy above its lowest value (less the work its joint friction has done since) is
// slowed by one uniform factor. It counters Rapier's f32 spin-up and never adds energy.
//
// Wheels, ground and a free root (DESIGN §2.6, §5.1; DEVIATIONS §5 "Wheels, ground, free root"):
//  - model.ground adds a fixed body with a half-space collider at groundLevel + (½ − HC) (groundY).
//    It is not one of `bodies`: no part, never removed, not in the energy guard.
//  - A rim becomes two colliders (shapes.ts WheelShape): a native cylinder ("round") that meets only
//    the ground and other round colliders, and a 32-gon prism ("hull") that meets only ordinary part
//    colliders. Collision groups are set only when the model has a rim or a ground; otherwise every
//    collider keeps Rapier's default groups, so such a model is simulated exactly as before.
//  - With a free root (rootIsFixed false) no body is fixed; bodies with a horizontal-axis rim
//    touching the ground at Play are the sinks of the joint-friction load ranking (loadMasses).
import type { ColliderDesc, EventQueue, ImpulseJoint, RigidBody, World } from '@dimforge/rapier3d-compat';
import { analyze } from '../core/kinematics';
import type { Joint, KinematicGraph } from '../core/kinematics';
import { groundLevel } from '../core/model';
import type { Model } from '../core/types';
import { E_FREE, HC, R_BORE, R_COLL_ROD } from '../geometry/dims';
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

/** Energy guard noise floor per unit of m·|g|·(1 + |com|) (f32 position rounding is ≈ 6e-8 of |com|). */
const NOISE = 1e-5;

/**
 * Joint friction levels μ (DESIGN §5.1 "Joint friction"): F_f = μ·m_j·|g| along a sliding joint's
 * axis, τ_f = F_f·R_BORE about a rotating joint's axis, m_j = the mass the joint carries (loadMasses).
 */
export const JOINT_FRICTION = { off: 0, low: 0.05, realistic: 0.2 } as const;
/**
 * With a ground, the grab spring presses a mechanism into it with at most this many times its
 * weight (lifting and sideways pulls keep the full cap).
 */
export const GRAB_PRESS_LIMIT = 2;
export type FrictionLevel = keyof typeof JOINT_FRICTION;
export const DEFAULT_FRICTION_LEVEL: FrictionLevel = 'realistic';
/**
 * Largest μ that SimOptions.jointFriction / setJointFriction accept (50× realistic; far beyond any
 * real pin, and keeps τ_f finite for every model).
 */
export const MAX_JOINT_FRICTION = 10;

/**
 * Stiction (see updateFriction): a free joint axis whose relative speed is below STICK_SPEED
 * (rad/s or units/s) after a step sticks at its current coordinate. While stuck, the friction
 * motor's target velocity is −offset/fixedDt (so the next step takes the joint back to where it
 * stuck; once the offset is within HOLD_DEADBAND the target is 0), which cancels the residual slip
 * that one Gauss–Seidel row per substep leaves; it lets go once the offset exceeds SLIP (rad or
 * units). STICK_SPEED sits above the ≈ 5e-3 rad/s that a held mechanism reports without moving
 * (f32 poses) and far below any swing's speed. SLIP is ≈ 10× the largest offset a held joint
 * reaches, and small enough that the hold can return at most τ_f·SLIP of energy per stick.
 * HOLD_DEADBAND keeps the target 0 for offsets the f32 pose cannot undo, so a body at rest does
 * not report a velocity it never moves with. Measured in DEVIATIONS §5 "Joint friction".
 */
const STICK_SPEED = 1e-2;
const SLIP = 2e-4;
const HOLD_DEADBAND = 1e-5;

/**
 * Gain of the friction motors (Rapier velocity motor, acceleration-based model, target 0). Large
 * enough that the motor row is effectively rigid below its limit (measured: a low gain is a soft
 * damper that lets a loaded joint creep; ≥ 1e6 holds as well as 1e9). The torque/force limit, not
 * this gain, sets how hard it pulls while sliding (see DEVIATIONS §5 "Joint friction").
 */
const FRICTION_GAIN = 1e9;

/** Rapier's linear speed clamp at lengthUnit 1, units/s (measured; see DEVIATIONS §5). */
const SPEED_CAP = 400;

/**
 * Collision groups (DESIGN §5.1 "Wheels"; Rapier InteractionGroups = membership << 16 | filter, a
 * pair interacts iff each one's membership meets the other's filter). Bits: ground 1, wheel round
 * collider 2, wheel hull 4, ordinary part collider 8, wheel ground guard 16 (shapes.ts
 * WheelShape.guard; not in DESIGN, see DEVIATIONS §5). Used only for models with a rim or a ground.
 */
const GROUP = {
  ground: (0x1 << 16) | (0x2 | 0x8 | 0x10),
  round: (0x2 << 16) | (0x1 | 0x2),
  hull: (0x4 << 16) | 0x8,
  part: (0x8 << 16) | (0x1 | 0x4 | 0x8),
  guard: (0x10 << 16) | 0x1,
} as const;

/** Friction of a wheel's round collider (a tyre; DESIGN §5.1; combine rule average with the 0.4 of the ground and parts). */
export const TYRE_FRICTION = 0.8;

/**
 * A body with a horizontal-axis rim whose lowest point is within this distance of the ground at
 * Play is a sink of the joint-friction load ranking (DESIGN §5.1 "Free root"), units.
 */
export const GROUND_SINK_DIST = 0.05;

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
  /** Angular damping of every dynamic body. Default 0 (DESIGN §5.1: no body damping; joints have friction instead). */
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
  /**
   * Energy guard (see guardEnergy): stop the f32 spin drift inside Rapier from adding energy. Default
   * true. Only ever removes energy, never adds it.
   */
  energyGuard?: boolean;
  /**
   * How far a group's energy may rise above the lowest value it has had, as a fraction of the
   * group's peak kinetic energy, before the guard scales its velocities down. Default 0.01.
   */
  energyGuardBand?: number;
  /**
   * Joint friction coefficient μ (DESIGN §5.1 "Joint friction"; levels in JOINT_FRICTION; at most
   * MAX_JOINT_FRICTION). Every joint resists its free relative motion with dry friction of at most
   * F_f = μ·m_j·|g| along a sliding axis and τ_f = F_f·R_BORE about a rotation axis, m_j = the mass
   * the joint carries (see Simulation.loadMasses) and |g| the magnitude of `gravity` (so without
   * gravity there is no joint friction: the load is weight). 0 adds nothing to the world: the
   * simulation is then exactly the frictionless one. Change it while running with
   * setJointFriction. Default JOINT_FRICTION.realistic (0.2).
   */
  jointFriction?: number;
  /**
   * Tilt of the ground (only with model.ground), degrees, about +Z through the point of the floor
   * under the mean cell centre: for θ > 0 the floor's normal is (sin θ, cos θ, 0), so it falls
   * toward +X and things roll toward +X. Default 0. Tests only for now (DESIGN §5.1 "Ground").
   */
  groundSlopeDeg?: number;
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
  energyGuard: true,
  energyGuardBand: 0.01,
  jointFriction: JOINT_FRICTION[DEFAULT_FRICTION_LEVEL] as number,
  groundSlopeDeg: 0,
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
  /** Relative angular velocity of B with respect to A about A's joint axis, rad/s. */
  omega: number;
  /** Relative velocity of B with respect to A at B's anchor, along A's joint axis, units/s. */
  speed: number;
  /** Friction torque limit τ_f about the axis (0 for a prismatic joint, with friction off or once dead). */
  frictionTorque: number;
  /** Friction force limit F_f along the axis (0 for a revolute joint, with friction off or once dead). */
  frictionForce: number;
  /** Load mass m_j the friction limits are computed from (see Simulation.loadMasses). */
  loadMass: number;
}

/** Stiction state of one free joint axis (see updateFriction). */
interface Stick {
  /** Joint coordinate after the last step: relative angle (rad, from the build pose) or slide (units). */
  x: number;
  stuck: boolean;
  /** Coordinate it stuck at. */
  at: number;
  /** Motor target velocity currently set. */
  target: number;
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
  /** Engine mass properties cached for the energy guard (set on the first guarded step). */
  mp?: { mass: number; inertia: Vec3; frame: Quat };
}

/** Energy-guard state of one group of dynamic bodies (see guardEnergy). */
interface GuardGroup {
  /** False until the next guarded step sets eRef / kPeak from the current state. */
  init: boolean;
  /** Lowest total energy (kinetic + potential) the group has had since init. */
  eRef: number;
  /** Highest kinetic energy since init. */
  kPeak: number;
  /** Rounding noise of the group's potential energy (f32 positions), set at init; see guardEnergy. */
  floor: number;
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
  /** Load mass m_j for joint friction (see loadMasses; Infinity if both bodies are fixed). */
  mj: number;
  /** True once friction motors were configured on this joint (they then stay, at limit 0 when off). */
  motors: boolean;
  /** Stiction state of the rotation (AngX) and slide (LinX) axes. */
  ang: Stick;
  lin: Stick;
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
const ANG_X = 3 as RawAxis; // RAPIER.JointAxis.AngX (asserted in tests/physics/friction.test.ts)
type RawMotorModel = Parameters<World['impulseJoints']['raw']['jointConfigureMotorModel']>[2];
const ACCELERATION_BASED = 0 as RawMotorModel; // RAPIER.MotorModel.AccelerationBased

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
  /** Energy guard: collision events (to merge groups that touch), union-find over body ids, state per root. */
  private readonly events: EventQueue | null = null;
  private readonly groupParent: number[] = [];
  private readonly groups = new Map<number, GuardGroup>();
  private readonly bodyOfCollider = new Map<number, number>();
  /** Energy the guard has removed so far (diagnostics). */
  guardRemoved = 0;
  private frictionValue: number;
  /** Friction work (τ_f·|Δθ| + F_f·|Δs|) done in the last step, per energy-guard group root. */
  private readonly frictionWork = new Map<number, number>();
  /**
   * y of the ground's physics plane (groundLevel + ½ − HC) at its pivot under the model's mean cell
   * centre; null without a ground (DESIGN §5.1 "Ground").
   */
  readonly groundY: number | null = null;
  /** Unit normal of the ground plane (tilted by groundSlopeDeg), and the plane's pivot point. */
  private readonly groundNormal: Vec3 = [0, 1, 0];
  private readonly groundPoint: Vec3 = [0, 0, 0];
  /** Dynamic bodies with a horizontal-axis rim touching the ground at Play (joint-friction load sinks). */
  private readonly groundSinks = new Set<number>();
  /** Collision groups are in use (the model has a rim or a ground). */
  private readonly grouped: boolean;

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
    this.frictionValue = checkFriction(o.jointFriction);
    this.gravity = options.gravity ? [...options.gravity] : [0, -G, 0];
    this.graph = analyze(model);
    let minY = Infinity;
    for (const p of model.parts) for (const c of p.cells) minY = Math.min(minY, c.y);
    this.removalY = Number.isFinite(minY) ? Math.min(o.removeBelowY, minY + o.removeBelowY) : o.removeBelowY;
    this.bodyOfPart = this.graph.bodyOfPart;
    const level = groundLevel(model);
    const hasRim = model.parts.some((p) => p.cells.some((c) => c.rim !== undefined));
    this.grouped = hasRim || level !== null;
    if (level !== null) {
      if (!Number.isFinite(o.groundSlopeDeg) || Math.abs(o.groundSlopeDeg) >= 90)
        throw new Error(`groundSlopeDeg must be in (−90, 90) (got ${o.groundSlopeDeg})`);
      const th = (o.groundSlopeDeg * Math.PI) / 180;
      const nrm: Vec3 = [Math.sin(th), Math.cos(th), 0];
      // The floor touches the model's lowest point along −n (nominal cells: unit cubes; rims: discs
      // of radius r, one cell thick), lifted by ½ − HC like the level floor; for θ = 0 this is
      // exactly groundLevel + (½ − HC). groundY is its height under the mean cell centre.
      let cx = 0;
      let cz = 0;
      let n = 0;
      let low = Infinity;
      const half = 0.5 * (Math.abs(nrm[0]) + Math.abs(nrm[1]) + Math.abs(nrm[2]));
      for (const p of model.parts)
        for (const c of p.cells) {
          cx += c.x;
          cz += c.z;
          n++;
          const h = c.x * nrm[0] + c.y * nrm[1] + c.z * nrm[2];
          low = Math.min(low, h - half);
          if (c.rim !== undefined) low = Math.min(low, h - c.rim * Math.sqrt(Math.max(0, 1 - nrm[c.axis]! ** 2)) - 0.5 * Math.abs(nrm[c.axis]!));
        }
      if (th === 0) low = level; // bit-exact level floor
      let d = low + (0.5 - HC); // plane: n · x = d
      // That is exact for hole cells (their colliders reach ±HC); a male cell's free end reaches
      // E_FREE along its axis, so a pin or axle standing on end (or poking out below the lowest beam)
      // would start E_FREE − HC = 0.02 inside the floor and be popped up (review finding). Lower the
      // plane to the lowest male collider point along −n; it never rises.
      for (const p of model.parts)
        for (const c of p.cells) {
          if (c.kind !== 'pin' && c.kind !== 'axle' && c.kind !== 'frictionPin') continue;
          const na = Math.abs(nrm[c.axis]!);
          const reach = E_FREE * na + R_COLL_ROD * Math.sqrt(Math.max(0, 1 - na * na));
          d = Math.min(d, c.x * nrm[0] + c.y * nrm[1] + c.z * nrm[2] - reach);
        }
      cx /= n;
      cz /= n;
      this.groundY = (d - nrm[0] * cx - nrm[2] * cz) / nrm[1];
      this.groundPoint = [cx, this.groundY, cz];
      this.groundNormal = nrm;
    }

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
      // The ground's collider first: Rapier's contact with a half-space created after a body's
      // collider drifts toward the half-space's origin like a bowl (a wheel at rest 100 units from
      // the floor's pivot rolled 0.35 units in 20 s; created first: 1.6e-3 — review finding,
      // spikes/review-wheels/bowl7.test.ts). The sinks need the bodies, so they come after.
      this.buildGroundCollider();
      this.buildBodies(model);
      this.buildGround(model);
      this.buildJoints();
      this.applyFriction();
      if (o.energyGuard) {
        this.events = new RAPIER.EventQueue(true);
        this.initGroups();
      }
    } catch (e) {
      this.events?.free();
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
      const addCollider = (cd: ColliderDesc) => {
        // Contact start events between dynamic bodies merge their energy-guard groups.
        if (!b.fixed && o.energyGuard) cd.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        const col = this.world.createCollider(cd, rb);
        this.bodyOfCollider.set(col.handle, b.id);
      };
      for (const p of parts) {
        for (const sh of partShapes(p, o.cylinderSegments)) {
          let cd;
          if (sh.kind === 'wheel') {
            this.addWheel(sh, ref, addCollider);
            continue;
          }
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
          if (this.grouped) cd.setCollisionGroups(GROUP.part);
          addCollider(cd);
        }
      }
      this.bodies.push({ id: b.id, fixed: b.fixed, ref, rb });
    }
    // Free bodies (no joints) can fall fast onto other parts: give them soft CCD (predictive
    // contacts reaching one step ahead at the speed cap). Rapier's hard CCD solver is switched off
    // in the constructor (maxCcdSubsteps = 0): it ran its time-of-impact clamp on jointed pairs
    // even though their contacts are disabled, stalling a sliding axle in its hole for a step
    // whenever it moved faster than its thinnest collider piece (see DEVIATIONS §5).
    // Bodies with a rim get it too, unlike DESIGN §5.1 "Wheels" (DEVIATIONS §5 "Wheels, ground,
    // free root": measured, it keeps a dropped wheel's round collider from sinking a step's travel
    // into the ground, and no wheel passed through liftarms with it in 816 drops).
    for (const sb of this.bodies)
      if (!sb.fixed && !jointed.has(sb.id)) sb.rb!.setSoftCcdPrediction(SPEED_CAP * o.fixedDt * 1.25);
    this.decoupleInertia();
  }

  /**
   * The two colliders of a rim (DESIGN §5.1 "Wheels"; shapes.ts WheelShape), positions relative to
   * the body's reference point `ref`:
   *  - round: native cylinder (Rapier builds it along local Y; rotated onto the wheel axis), mass
   *    of the annulus set explicitly (f64 values, like the prisms), tyre friction, group `round`;
   *  - hull: the bevelled 32-gon prism, density 0, part friction, group `hull`;
   *  - with a ground, the ground guard (WheelShape.guard): density 0, tyre friction, group `guard`.
   */
  private addWheel(sh: Extract<ReturnType<typeof partShapes>[number], { kind: 'wheel' }>, ref: Vec3, add: (cd: ColliderDesc) => void): void {
    const o = this.opts;
    const c = sub(sh.center, ref);
    // Rotation taking local +Y onto the wheel axis: X axis → −90° about Z, Y → identity, Z → +90° about X.
    const s = Math.SQRT1_2;
    const rot = sh.axis === 0 ? { x: 0, y: 0, z: -s, w: s } : sh.axis === 2 ? { x: s, y: 0, z: 0, w: s } : { x: 0, y: 0, z: 0, w: 1 };
    const m = sh.mass;
    const ia = m.inertia[sh.axis]! * o.density;
    const it = m.inertia[(sh.axis + 1) % 3]! * o.density;
    const round = RAPIER.ColliderDesc.cylinder(sh.halfLength, sh.radius)
      .setTranslation(c[0], c[1], c[2])
      .setRotation(rot)
      // Collider-local frame: the cylinder's axis is local Y.
      .setMassProperties(m.volume * o.density, { x: 0, y: 0, z: 0 }, { x: it, y: ia, z: it }, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(TYRE_FRICTION)
      .setRestitution(o.restitution)
      .setCollisionGroups(GROUP.round);
    add(round);
    const pts = new Float32Array(sh.hull.length * 3);
    sh.hull.forEach((q, i) => pts.set(sub(q, ref), i * 3));
    const hull = RAPIER.ColliderDesc.convexHull(pts);
    if (!hull) throw new Error('convex hull failed for a wheel');
    hull.setDensity(0).setFriction(o.friction).setRestitution(o.restitution).setCollisionGroups(GROUP.hull);
    add(hull);
    if (this.groundY === null) return; // the guard only meets the ground
    const gp = new Float32Array(sh.guard.length * 3);
    sh.guard.forEach((q, i) => gp.set(sub(q, ref), i * 3));
    const guard = RAPIER.ColliderDesc.convexHull(gp);
    if (!guard) throw new Error('convex hull failed for a wheel guard');
    // Frictionless (combine rule Min with the ground's 0.4): it only holds the wheel up, so where it
    // touches during an impact it cannot kick the wheel into rolling.
    guard.setDensity(0).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(o.restitution).setCollisionGroups(GROUP.guard);
    add(guard);
  }

  /**
   * The ground (DESIGN §5.1 "Ground"): a fixed body with a half-space collider through groundPoint
   * with normal groundNormal (buildGroundCollider, created before every other body); not one of
   * `bodies`. buildGround finds the joint-friction sinks: dynamic
   * bodies with a rim about a horizontal axis whose lowest point (nominal radius r) is within
   * GROUND_SINK_DIST of the nominal floor (groundLevel, i.e. the physics plane less ½ − HC).
   */
  private buildGroundCollider(): void {
    if (this.groundY === null) return;
    const n = this.groundNormal;
    const p0 = this.groundPoint;
    const rb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const cd = new RAPIER.ColliderDesc(new RAPIER.HalfSpace(xyz(n)))
      .setTranslation(p0[0], p0[1], p0[2])
      .setFriction(this.opts.friction)
      .setRestitution(this.opts.restitution)
      .setCollisionGroups(GROUP.ground);
    this.world.createCollider(cd, rb);
  }

  private buildGround(model: Model): void {
    if (this.groundY === null) return;
    const n = this.groundNormal;
    const p0 = this.groundPoint;
    const nominal = sub(p0, scale(n, 0.5 - HC)); // a point of the nominal floor
    for (const p of model.parts) {
      const bid = this.bodyOfPart.get(p.id);
      if (bid === undefined || this.bodies[bid]!.fixed) continue;
      for (const c of p.cells) {
        if (c.rim === undefined || c.axis === 1) continue;
        // Lowest point of the disc along −n: hub height above the plane less r·|n in the disc's plane|.
        const h = dot(sub([c.x, c.y, c.z], nominal), n) - c.rim * Math.sqrt(Math.max(0, 1 - n[c.axis]! ** 2));
        if (h <= GROUND_SINK_DIST + 1e-9) this.groundSinks.add(bid);
      }
    }
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
      const stick = (): Stick => ({ x: 0, stuck: false, at: 0, target: 0 });
      this.joints.push({ index, joint: j, sliding: j.type !== 'revolute', anchorA, anchorB, axis, handle, mj: 0, motors: false, ang: stick(), lin: stick() });
    });
    const mj = this.loadMasses();
    this.joints.forEach((sj, i) => (sj.mj = mj[i]!));
  }

  /**
   * Load mass m_j of every joint (graph.joints order) for joint friction (DESIGN §5.1, DEVIATIONS
   * §5 "Joint friction: load estimate"): the weight each joint passes on toward the fixed bodies,
   * fixed for the run. Engine masses (after decoupleInertia, which keeps the mass).
   *  - Bodies are ranked by their joint distance from a fixed body. Starting with the farthest,
   *    each dynamic body passes its own mass plus everything passed to it on to its joints that
   *    lead one step closer to a fixed body, in equal shares. A joint's load is what it passes.
   *    So in a chain every pivot carries everything below it, and a loop shares a coupler's
   *    weight between the two sides.
   *  - A joint that passes nothing (it joins two bodies at the same distance, e.g. across a loop)
   *    and every joint of a group of bodies with no path to a fixed body: the lighter body's mass
   *    (a fixed body counts as infinitely heavy; two fixed bodies give Infinity, i.e. no friction).
   *  - With a ground, bodies with a horizontal-axis rim touching it at Play (groundSinks) count as
   *    sinks at distance 0 like fixed bodies (DESIGN §5.1 "Free root"): a cart's axles each carry
   *    their share of the chassis, a wheel's own weight goes straight into the ground.
   */
  private loadMasses(): number[] {
    const mass = (id: number) => (this.bodies[id]!.fixed ? Infinity : this.bodies[id]!.rb!.mass());
    const joints = this.graph.joints;
    const dist = new Map<number, number>();
    let frontier = this.bodies.filter((b) => b.fixed || this.groundSinks.has(b.id)).map((b) => b.id);
    for (const id of frontier) dist.set(id, 0);
    for (let d = 1; frontier.length; d++) {
      const next: number[] = [];
      for (const u of frontier)
        for (const j of joints) {
          const o = j.bodyA === u ? j.bodyB : j.bodyB === u ? j.bodyA : -1;
          if (o < 0 || dist.has(o)) continue;
          dist.set(o, d);
          next.push(o);
        }
      frontier = next;
    }
    const passed = joints.map(() => 0);
    const carried = new Map<number, number>();
    const order = this.bodies.filter((b) => !b.fixed && dist.get(b.id)! > 0).sort((a, b) => dist.get(b.id)! - dist.get(a.id)! || a.id - b.id);
    for (const b of order) {
      const d = dist.get(b.id)!;
      const load = mass(b.id) + (carried.get(b.id) ?? 0);
      const down: number[] = [];
      joints.forEach((j, i) => {
        const o = j.bodyA === b.id ? j.bodyB : j.bodyB === b.id ? j.bodyA : -1;
        if (o >= 0 && dist.get(o) === d - 1) down.push(i);
      });
      for (const i of down) {
        const j = joints[i]!;
        const o = j.bodyA === b.id ? j.bodyB : j.bodyA;
        passed[i] = passed[i]! + load / down.length;
        if (dist.get(o)! > 0) carried.set(o, (carried.get(o) ?? 0) + load / down.length);
      }
    }
    return joints.map((j, i) => (passed[i]! > 0 ? passed[i]! : Math.min(mass(j.bodyA), mass(j.bodyB))));
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
  // Joint friction

  /** Joint friction coefficient μ in use (see SimOptions.jointFriction). */
  get jointFriction(): number {
    return this.frictionValue;
  }

  /**
   * Change the joint friction coefficient μ (≥ 0, finite; see JOINT_FRICTION). Takes effect on the
   * next fixed step; allowed at any time, also while a body is grabbed.
   */
  setJointFriction(mu: number): void {
    this.alive();
    const v = checkFriction(mu);
    if (v === this.frictionValue) return;
    this.frictionValue = v;
    this.applyFriction();
    // The energy guard's reference assumed the old dissipation: start it afresh (as on grab).
    for (const b of this.bodies) if (!b.fixed && b.rb) this.resetGroup(b.id);
  }

  /** Friction limits of a joint at the current μ: torque τ_f about and force F_f along its axis. */
  private frictionLimits(sj: SimJoint): { torque: number; force: number } {
    const mu = this.frictionValue;
    if (!(mu > 0) || !Number.isFinite(sj.mj)) return { torque: 0, force: 0 };
    const force = mu * sj.mj * len(this.gravity);
    const t = sj.joint.type;
    return { torque: t === 'prismatic' ? 0 : force * R_BORE, force: t === 'revolute' ? 0 : force };
  }

  /**
   * Dry friction on every joint's free axes: a velocity motor with target 0 whose torque/force is
   * limited to τ_f / F_f (Rapier's maxForce is a force or torque, applied per substep: measured, see
   * DEVIATIONS §5 "Joint friction"). Sliding, it pulls with exactly that limit against the relative
   * motion; below the limit it holds the relative velocity at 0 (stiction). With μ = 0 a joint that
   * never had friction gets no motor at all (the world is exactly the frictionless one); a joint
   * that had friction keeps its motor rows at limit 0 and target 0, which apply no impulse.
   * Every call forgets the stiction state (it is re-detected after the next step).
   */
  private applyFriction(): void {
    const raw = this.world.impulseJoints.raw;
    this.frictionWork.clear();
    for (const sj of this.joints) {
      if (!sj.handle) continue;
      const { torque, force } = this.frictionLimits(sj);
      if (!sj.motors && torque === 0 && force === 0) continue;
      const h = sj.handle.handle;
      for (const [axis, st, limit] of this.frictionAxes(sj, torque, force)) {
        if (!sj.motors) raw.jointConfigureMotorModel(h, axis, ACCELERATION_BASED);
        if (!sj.motors || st.target !== 0) raw.jointConfigureMotorVelocity(h, axis, 0, FRICTION_GAIN);
        raw.jointSetMotorMaxForce(h, axis, limit);
        st.stuck = false;
        st.target = 0;
      }
      sj.motors = true;
      this.measureJoint(sj);
    }
  }

  /** The free axes of a joint with their stiction state and friction limit. */
  private frictionAxes(sj: SimJoint, torque: number, force: number): [RawAxis, Stick, number][] {
    const t = sj.joint.type;
    const out: [RawAxis, Stick, number][] = [];
    if (t !== 'prismatic') out.push([ANG_X, sj.ang, torque]);
    if (t !== 'revolute') out.push([LIN_X, sj.lin, force]);
    return out;
  }

  /**
   * Relative coordinates and speeds of a live joint: angle of B relative to A about the axis since
   * the build pose (rad, in (−π, π]), B's anchor along A's axis (units), and their rates — the same
   * quantities and signs as jointStates' omega / speed, which are also the signs of the friction
   * motors' target velocity (measured).
   */
  private jointCoords(sj: SimJoint): { theta: number; omega: number; slide: number; speed: number } {
    const A = this.bodies[sj.joint.bodyA]!.rb!;
    const B = this.bodies[sj.joint.bodyB]!.rb!;
    const qa = quat(A.rotation());
    const qb = quat(B.rotation());
    const axA = rotate(qa, sj.axis);
    const rel = qmul(conj(qa), qb);
    const theta = 2 * Math.atan2(dot([rel[0], rel[1], rel[2]], sj.axis), rel[3]);
    const omega = dot(sub(vec(B.angvel()), vec(A.angvel())), axA);
    if (!sj.sliding) return { theta, omega, slide: 0, speed: 0 };
    const pa = add(rotate(qa, sj.anchorA), vec(A.translation()));
    const pb = add(rotate(qb, sj.anchorB), vec(B.translation()));
    const slide = dot(sub(pb, pa), axA);
    const speed = dot(sub(vec(B.velocityAtPoint(xyz(pb))), vec(A.velocityAtPoint(xyz(pb)))), axA);
    return { theta, omega, slide, speed };
  }

  /** Record a joint's current coordinates as the reference for the next step's friction work. */
  private measureJoint(sj: SimJoint): void {
    if (!sj.handle) return;
    const c = this.jointCoords(sj);
    sj.ang.x = c.theta;
    sj.lin.x = c.slide;
  }

  /**
   * After every fixed step with μ > 0, for each free axis that has friction:
   *  - friction work: limit × |change of the coordinate| is added to the step's friction work of the
   *    body's energy-guard group (a sliding friction motor is saturated, so this is the energy it
   *    took out; see guardEnergy);
   *  - stiction: an axis whose relative speed is below STICK_SPEED sticks at its coordinate. While
   *    stuck its motor's target velocity is −offset / fixedDt (0 within HOLD_DEADBAND): with the
   *    load below the limit the motor holds and steers the joint back to where it stuck, so the
   *    slow slip that one Gauss–Seidel row per substep leaves (DEVIATIONS §5) cannot accumulate.
   *    Once the offset exceeds SLIP the load has overcome the limit: it lets go and the target is 0
   *    again (pure dry friction). The hold can only pull back an offset of at most SLIP, so it
   *    returns at most limit·SLIP of energy per stick.
   */
  private updateFriction(): void {
    const raw = this.world.impulseJoints.raw;
    this.frictionWork.clear();
    const hold = 1 / this.fixedDt;
    for (const sj of this.joints) {
      if (!sj.handle || !sj.motors) continue;
      const { torque, force } = this.frictionLimits(sj);
      if (torque === 0 && force === 0) continue;
      const c = this.jointCoords(sj);
      const dyn = this.bodies[sj.joint.bodyA]!.fixed ? sj.joint.bodyB : sj.joint.bodyA;
      let work = 0;
      for (const [axis, st, limit] of this.frictionAxes(sj, torque, force)) {
        const angular = axis === ANG_X;
        const x = angular ? c.theta : c.slide;
        const rate = angular ? c.omega : c.speed;
        work += limit * Math.abs(angular ? wrapAngle(x - st.x) : x - st.x);
        st.x = x;
        if (!st.stuck && Math.abs(rate) < STICK_SPEED) {
          st.stuck = true;
          st.at = x;
        }
        let target = 0;
        if (st.stuck) {
          const off = angular ? wrapAngle(x - st.at) : x - st.at;
          if (Math.abs(off) > SLIP) st.stuck = false;
          else if (Math.abs(off) > HOLD_DEADBAND) target = -off * hold;
        }
        if (target !== st.target) {
          raw.jointConfigureMotorVelocity(sj.handle.handle, axis, target, FRICTION_GAIN);
          st.target = target;
        }
      }
      if (this.events && work > 0) {
        const r = this.findGroup(dyn);
        this.frictionWork.set(r, (this.frictionWork.get(r) ?? 0) + work);
      }
    }
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
      if (this.events) this.world.step(this.events);
      else this.world.step();
      this.stepCount++;
      this.removeFallen();
      if (this.frictionValue > 0) this.updateFriction();
      if (this.events) this.guardEnergy();
    }
  }

  // ------------------------------------------------------------------------------------------
  // Energy guard

  /**
   * Groups: dynamic bodies linked by joints (not through fixed bodies) share a group; groups whose
   * bodies start touching are merged for good. Energy moves within a group (through joints and
   * contacts) but not between groups, except through a fixed body, which only takes energy away.
   */
  private initGroups(): void {
    for (const b of this.bodies) this.groupParent[b.id] = b.id;
    for (const j of this.graph.joints) {
      if (this.bodies[j.bodyA]!.fixed || this.bodies[j.bodyB]!.fixed) continue;
      this.unionGroups(j.bodyA, j.bodyB);
    }
    for (const b of this.bodies) if (!b.fixed) this.groupState(b.id);
  }

  private findGroup(id: number): number {
    let r = id;
    while (this.groupParent[r] !== r) r = this.groupParent[r]!;
    while (this.groupParent[id] !== r) {
      const next = this.groupParent[id]!;
      this.groupParent[id] = r;
      id = next;
    }
    return r;
  }

  private unionGroups(a: number, b: number): void {
    const ra = this.findGroup(a);
    const rb = this.findGroup(b);
    if (ra === rb) return;
    const [lo, hi] = ra < rb ? [ra, rb] : [rb, ra];
    this.groupParent[hi] = lo;
    this.groups.delete(hi);
    this.groupState(lo).init = false;
  }

  private groupState(id: number): GuardGroup {
    const r = this.findGroup(id);
    let g = this.groups.get(r);
    if (!g) {
      g = { init: false, eRef: 0, kPeak: 0, floor: 0 };
      this.groups.set(r, g);
    }
    return g;
  }

  /** Forget a group's energy reference (external work was done on it: grab, removal, contact merge). */
  private resetGroup(bodyId: number): void {
    if (this.events) this.groupState(bodyId).init = false;
  }

  /**
   * Energy guard (DEVIATIONS §5 "Free rotation gains speed"). Rapier's f32 gyroscopic correction
   * scales every spinning body's ω up by ≈ 1e-7 per substep, so a frictionless mechanism slowly
   * gains energy (an arm on an axle climbed from horizontal to vertical in 60 s). After every
   * fixed step, per group (see initGroups): E = kinetic + potential energy, eRef = the lowest E
   * since the group's reference was (re)set, each step also lowered by the work the group's joint
   * friction did in that step (updateFriction; 0 at μ = 0), kPeak = the highest kinetic energy
   * since then. If
   * E > eRef + max(band·kPeak, floor), all velocities of the group are scaled by one factor s < 1
   * so that E comes back to that cap. `floor` (1e-5 · Σ m·|g|·(1 + |com|)) sits above the f32
   * rounding noise of the potential energy, so a mechanism starting from rest — or balanced on an
   * unstable equilibrium, where the kinetic energy is far below that noise — is never held still. A uniform scale keeps every joint's (homogeneous) velocity constraint
   * and every contact's sign, so the motion is unchanged except for its speed. The guard never adds
   * energy: losses (joint solve, impacts, limit stops) lower eRef and stay lost. The reference is
   * (re)set on the first step, while a body of the group is grabbed, after its release, when a body
   * of the group is removed, when two groups merge and when the friction level changes, so
   * external work is never undone.
   */
  private guardEnergy(): void {
    const ev = this.events!;
    ev.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.bodyOfCollider.get(h1);
      const b = this.bodyOfCollider.get(h2);
      if (a === undefined || b === undefined || a === b) return;
      if (this.bodies[a]!.fixed || this.bodies[b]!.fixed) return;
      this.unionGroups(a, b);
    });
    if (this.grabState?.body.rb) this.resetGroup(this.grabState.body.id);
    const sums = new Map<number, { e: number; k: number; noise: number; members: SimBody[] }>();
    const gl = len(this.gravity);
    for (const b of this.bodies) {
      const rb = b.rb;
      if (b.fixed || !rb) continue;
      if (!b.mp) b.mp = { mass: rb.mass(), inertia: vec(rb.principalInertia()), frame: quat(rb.principalInertiaLocalFrame()) };
      const { mass, inertia: I, frame } = b.mp;
      const v = vec(rb.linvel());
      const wl = rotate(conj(qmul(quat(rb.rotation()), frame)), vec(rb.angvel()));
      const k = 0.5 * mass * dot(v, v) + 0.5 * (I[0] * wl[0] ** 2 + I[1] * wl[1] ** 2 + I[2] * wl[2] ** 2);
      const com = vec(rb.worldCom());
      const e = k - mass * dot(this.gravity, com);
      const noise = NOISE * mass * gl * (1 + len(com));
      const r = this.findGroup(b.id);
      const s = sums.get(r);
      if (s) {
        s.e += e;
        s.k += k;
        s.noise += noise;
        s.members.push(b);
      } else sums.set(r, { e, k, noise, members: [b] });
    }
    const band = this.opts.energyGuardBand;
    for (const [r, { e, k, noise, members }] of sums) {
      const g = this.groupState(r);
      if (!g.init) {
        g.init = true;
        g.eRef = e;
        g.kPeak = k;
        g.floor = noise;
        continue;
      }
      if (k > g.kPeak) g.kPeak = k;
      // Joint friction must have taken out at least the work it did (updateFriction): lower the
      // reference by it, so f32 spin gain cannot hide behind friction's loss (with μ = 0 this
      // subtracts nothing and the guard is exactly the frictionless one).
      const work = this.frictionWork.get(r);
      if (work) g.eRef -= work;
      if (e < g.eRef) {
        g.eRef = e;
        continue;
      }
      const excess = e - (g.eRef + Math.max(band * g.kPeak, g.floor));
      if (!(excess > 0) || !(k > 0)) continue;
      const f = Math.sqrt(Math.max(0, 1 - excess / k));
      for (const b of members) {
        const rb = b.rb!;
        const v = rb.linvel();
        const w = rb.angvel();
        rb.setLinvel({ x: v.x * f, y: v.y * f, z: v.z * f }, true);
        rb.setAngvel({ x: w.x * f, y: w.y * f, z: w.z * f }, true);
      }
      this.guardRemoved += k * (1 - f * f);
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
    this.resetGroup(b.id);
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

  /**
   * Set a dynamic body's velocity: `linear` is the velocity of its centre of mass (world, units/s),
   * `angular` its angular velocity (world, rad/s; omitted = unchanged). External work, so the
   * energy guard's reference for the body's group is reset (as on a grab release). Returns false
   * (and does nothing) for a fixed, removed or unknown body, or a non-finite vector.
   */
  setBodyVelocity(bodyId: number, linear: Vec3, angular?: Vec3): boolean {
    this.alive();
    const b = this.bodies[bodyId];
    if (!b?.rb || b.fixed) return false;
    const ok = (v: Vec3) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
    if (!ok(linear) || (angular !== undefined && !ok(angular))) return false;
    b.rb.setLinvel(xyz(linear), true);
    if (angular) b.rb.setAngvel(xyz(angular), true);
    this.resetGroup(b.id);
    return true;
  }

  /** Is the body one of the joint-friction load sinks on the ground (DESIGN §5.1 "Free root")? */
  isGroundSink(bodyId: number): boolean {
    return this.groundSinks.has(bodyId);
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
      this.resetGroup(g.body.id);
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
   * sags by less than g/ω² ≈ 0.31 units at 10 Hz). |F| is capped at M·100·G, and with a ground its
   * component into the ground at GRAB_PRESS_LIMIT·M·G.
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
    if (this.groundY !== null) {
      // Pressing into the ground is limited to GRAB_PRESS_LIMIT × the mechanism's weight: at the
      // full cap (100 g) the round wheel colliders of light wheel bodies gave way and sank up to
      // 1.4 units into the floor (DEVIATIONS §5 "Wheels, ground, free root").
      const into = -dot(f, this.groundNormal);
      const cap = GRAB_PRESS_LIMIT * M * G;
      if (into > cap) f = add(f, scale(this.groundNormal, into - cap));
    }
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
      if (!sj.handle || !A || !B)
        return { ...base, alive: false, error: 0, slide: 0, tilt: 0, omega: 0, speed: 0, frictionTorque: 0, frictionForce: 0, loadMass: sj.mj };
      const { torque: frictionTorque, force: frictionForce } = this.frictionLimits(sj);
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
      const omega = dot(sub(vec(B.angvel()), vec(A.angvel())), axA);
      const speed = dot(sub(vec(B.velocityAtPoint(xyz(pb))), vec(A.velocityAtPoint(xyz(pb)))), axA);
      return { ...base, alive: true, error, slide, tilt, omega, speed, frictionTorque, frictionForce, loadMass: sj.mj };
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
    this.events?.free();
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


/** Validate μ: a number in [0, MAX_JOINT_FRICTION]; −0 becomes 0. */
function checkFriction(mu: number): number {
  if (typeof mu !== 'number' || !(mu >= 0 && mu <= MAX_JOINT_FRICTION))
    throw new Error(`jointFriction must be a number in [0, ${MAX_JOINT_FRICTION}] (got ${mu})`);
  return mu + 0;
}

/** Angle wrapped to (−π, π]. */
function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));
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
