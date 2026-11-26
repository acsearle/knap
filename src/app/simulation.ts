// Simulate mode (§7.1, §5): one Simulation of a frozen model, stepped from the viewport's frame
// callback, with poses applied to the parts every frame, body grabbing, and clean failure.
import type { Model } from '../core';
import { pickCell } from '../editor';
import type { PickHit, Ray } from '../editor';
import { Simulation } from '../physics';
import type { Transform } from '../physics';
import type { DragHandler, Viewport, ViewportPointerEvent } from '../view';

/** Simulated seconds advanced by the Step button (8 fixed steps at 1/480 s). */
export const STEP_SECONDS = 1 / 60;
/** A joint error beyond this (units) means the solver has blown up: stop rather than show garbage. */
export const MAX_JOINT_ERROR = 2;
/** "Can't keep up" stays visible this long after the last dropped step (ms). */
const SLOW_HOLD_MS = 1200;

export interface SimHost {
  /** The simulation failed (exception / NaN / blow-up); the host stops it and shows the message. */
  fail(message: string): void;
  /** Per-frame readout. */
  readout(time: number, slow: boolean): void;
}

export class SimSession {
  readonly sim: Simulation;
  private pausedValue = false;
  private readonly hidden = new Set<number>();
  private readonly partIds: number[];
  private unFrame: (() => void) | null = null;
  private lastDropped = 0;
  private lastDropAt = -Infinity;
  private lastNow = 0;
  private grabPlane: { point: readonly [number, number, number]; normal: readonly [number, number, number] } | null = null;
  private failed = false;
  private disposed = false;
  /** Bound once: the transform lookup used for picking in simulate mode. */
  readonly transformOf = (partId: number): Transform | null => (this.disposed ? null : this.sim.partTransform(partId));

  private constructor(
    private readonly vp: Viewport,
    readonly model: Model,
    sim: Simulation,
    private readonly host: SimHost,
  ) {
    this.sim = sim;
    this.partIds = model.parts.map((p) => p.id);
  }

  /** Build the Rapier world for `model` (awaits the physics WASM on first use). */
  static async start(
    vp: Viewport,
    model: Model,
    speed: number,
    host: SimHost,
    opts: { paused?: boolean; jointFriction?: number } = {},
  ): Promise<SimSession> {
    const sim = await Simulation.create(model, { speed, ...(opts.jointFriction !== undefined ? { jointFriction: opts.jointFriction } : {}) });
    const s = new SimSession(vp, model, sim, host);
    vp.setDragHandler(s.dragHandler);
    s.paused = !!opts.paused;
    if (!s.paused) s.subscribe();
    return s;
  }

  /** While paused nothing is stepped and the frame loop is off (the view renders on demand). */
  get paused(): boolean {
    return this.pausedValue;
  }

  set paused(on: boolean) {
    if (this.disposed || on === this.pausedValue) return;
    this.pausedValue = on;
    if (on) {
      this.unFrame?.();
      this.unFrame = null;
      this.host.readout(this.sim.time, false);
    } else this.subscribe();
  }

  private subscribe(): void {
    if (this.unFrame) return;
    this.lastNow = 0;
    this.unFrame = this.vp.onFrame((dt, now) => this.frame(dt, now));
  }

  get time(): number {
    return this.sim.time;
  }

  setSpeed(speed: number): void {
    this.sim.setSpeed(speed);
  }

  /** Joint friction μ (DESIGN §5.1); takes effect on the next fixed step. No-op once disposed. */
  setJointFriction(mu: number): void {
    if (!this.disposed) this.sim.setJointFriction(mu);
  }

  /** Exactly n fixed steps (Step button, tests), then show the result. */
  stepFixed(n: number): void {
    this.guard(() => {
      this.sim.stepFixed(n);
      this.apply();
    });
    this.vp.requestRender();
    if (!this.failed && !this.disposed) this.host.readout(this.sim.time, false);
  }

  /** Is the part's body dynamic (grabbable)? */
  isDynamicPart(partId: number): boolean {
    const b = this.sim.bodyOf(partId);
    return b !== undefined && !this.sim.graph.bodies[b]?.fixed && this.sim.hasBody(b);
  }

  /**
   * Give the body holding `partId` a velocity (units/s; DESIGN §7.5 pushBody, so e2e can roll a cart
   * without a mouse; `angular` in rad/s, omitted = unchanged). False when the part has no dynamic
   * body or a vector is not finite.
   */
  pushBody(partId: number, linear: readonly [number, number, number], angular?: readonly [number, number, number]): boolean {
    if (this.disposed || !this.isDynamicPart(partId)) return false;
    const ok = this.sim.setBodyVelocity(this.sim.bodyOf(partId)!, [...linear], angular && [...angular]);
    this.vp.requestRender();
    return ok;
  }

  /** Pick a part under a ray at its current simulated pose (cell cubes and wheel discs). */
  pick(ray: Ray): PickHit | null {
    if (this.disposed) return null;
    return pickCell(this.model, ray, { transform: this.transformOf });
  }

  readonly dragHandler: DragHandler = {
    claim: (press: ViewportPointerEvent): boolean => {
      if (this.disposed || this.failed) return false;
      const hit = this.pick(press.ray);
      if (!hit) return false;
      const body = this.sim.bodyOf(hit.partId);
      if (body === undefined || this.sim.graph.bodies[body]?.fixed) return false;
      if (!this.sim.grab(body, [hit.point[0], hit.point[1], hit.point[2]])) return false;
      this.grabPlane = { point: hit.point, normal: press.ray.dir };
      return true;
    },
    move: (e: ViewportPointerEvent): void => {
      const pl = this.grabPlane;
      if (!pl || this.disposed) return;
      const { origin: o, dir: d } = e.ray;
      const n = pl.normal;
      const den = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
      if (Math.abs(den) < 1e-9) return;
      const t = ((pl.point[0] - o[0]) * n[0] + (pl.point[1] - o[1]) * n[1] + (pl.point[2] - o[2]) * n[2]) / den;
      this.sim.dragTo([o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]]);
    },
    end: (): void => {
      this.grabPlane = null;
      if (!this.disposed) this.sim.release();
    },
  };

  get grabbedBody(): number | null {
    return this.disposed ? null : this.sim.grabbed;
  }

  private frame(dt: number, now: number): void {
    if (this.disposed || this.failed) return;
    this.guard(() => {
      if (!this.paused) this.sim.step(dt);
      this.apply();
    });
    if (this.disposed || this.failed) return;
    // Falling behind = the simulation dropped steps (its per-frame work cap), or frames came so
    // far apart that the viewport clamped dt (the page renders too slowly for real time).
    const dropped = this.sim.droppedSteps;
    const realDt = this.lastNow > 0 ? (now - this.lastNow) / 1000 : dt;
    this.lastNow = now;
    if (dropped > this.lastDropped || (!this.paused && realDt > dt + 0.01)) {
      this.lastDropped = dropped;
      this.lastDropAt = now;
    }
    this.host.readout(this.sim.time, !this.paused && now - this.lastDropAt < SLOW_HOLD_MS);
  }

  /** Run `fn`; on an exception or invalid numbers, fail once (the host stops the session). */
  private guard(fn: () => void): void {
    if (this.failed || this.disposed) return;
    try {
      fn();
    } catch (e) {
      this.failed = true;
      this.host.fail(e instanceof Error ? e.message : String(e));
    }
  }

  /** Apply every part's simulated pose to the viewport; hide parts whose body was removed. */
  private apply(): void {
    const vp = this.vp;
    for (const id of this.partIds) {
      const t = this.sim.partTransform(id);
      if (!t) {
        if (!this.hidden.has(id)) {
          this.hidden.add(id);
          vp.setPartVisible(id, false);
        }
        continue;
      }
      const p = t.p;
      const q = t.q;
      if (!(Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]) && Number.isFinite(q[0]) && Number.isFinite(q[1]) && Number.isFinite(q[2]) && Number.isFinite(q[3]))) {
        throw new Error('the solver produced invalid numbers (NaN)');
      }
      vp.setPartTransform(id, p, q);
    }
    const err = this.sim.jointError();
    if (Number.isNaN(err)) throw new Error('the solver produced invalid numbers (NaN)');
    if (err > MAX_JOINT_ERROR) throw new Error(`the solver became unstable (joint error ${err.toFixed(2)} units)`);
  }

  /** Stop stepping and free the Rapier world; the viewport's transforms are the host's to clear. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unFrame?.();
    this.unFrame = null;
    this.vp.setDragHandler(null);
    this.grabPlane = null;
    this.sim.dispose();
  }
}
