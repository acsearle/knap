// Scenario builders for the m8 sim/geometry review (reviewer simgeo). Every builder works for a gear
// axis ax ∈ {0,1,2}: in-plane coordinates (u, v) = gearPlaneBasis(ax), layer along ax.
import { ModelBuilder } from '../../../src/core/examples';
import { gearPlaneBasis } from '../../../src/core/gears';
import { makeCell, setFixRoot, setGear, setGround, validateModel } from '../../../src/core/model';
import type { Axis, Cell, Kind, Model } from '../../../src/core/types';
import type { Simulation } from '../../../src/physics/sim';

export type P = [number, number, number];

export function at(ax: Axis, u: number, v: number, layer: number): P {
  const [iu, iv] = gearPlaneBasis(ax);
  const p: P = [0, 0, 0];
  p[iu] = u;
  p[iv] = v;
  p[ax] = layer;
  return p;
}
export const C = (ax: Axis, u: number, v: number, l: number, kind: Kind = 'pinHole', axis: Axis = ax): Cell => {
  const p = at(ax, u, v, l);
  return makeCell(p[0], p[1], p[2], kind, axis);
};

export function finish(b: ModelBuilder, root: number, gears: [number, P, number][], o: { ground?: boolean; free?: boolean } = {}): Model {
  let m = b.root(root).build();
  // set the teeth raw (setGear one at a time can fail where the final model is valid: an 8 beside a
  // plain hub that is about to become its partner), then validate the whole.
  m = { ...m, version: 3, parts: m.parts.map((p) => ({ ...p, cells: p.cells.map((c) => {
    const g = gears.find(([id, q]) => id === p.id && q[0] === c.x && q[1] === c.y && q[2] === c.z);
    return g ? makeCell(c.x, c.y, c.z, c.kind, c.axis, g[2], true) : c;
  }) })) };
  void setGear;
  if (o.ground) m = setGround(m, true);
  if (o.free) m = setFixRoot(m, false);
  const errs = validateModel(m);
  if (errs.length) throw new Error('invalid model: ' + JSON.stringify(errs.slice(0, 3)));
  return m;
}

/** A smooth pin from the frame hole at layer lf into the part's hole at layer lp. */
export function pinAt(b: ModelBuilder, ax: Axis, u: number, v: number, lf: number, lp: number): number {
  return b.add([C(ax, u, v, lf, 'frictionPin'), C(ax, u, v, lp, 'pin')]);
}

/**
 * gears[i] = radius; consecutive gears in line along +u at mesh distance, all in layer 1, each on a
 * column (pivot hole at layer 0 on a frame pin from the frame beam at layer −1). Optional arm on the
 * last gear's column at layer 2 (`arm` further holes along +u).
 */
export function chain(ax: Axis, radii: number[], o: { arm?: number; ground?: boolean } = {}): { model: Model; parts: number[]; frame: number; pos: number[] } {
  const b = new ModelBuilder();
  const pos = [0];
  for (let i = 1; i < radii.length; i++) pos.push(pos[i - 1]! + radii[i - 1]! + radii[i]!);
  const last = pos[pos.length - 1]!;
  const fr: Cell[] = [];
  for (let u = 0; u <= last; u++) fr.push(C(ax, u, 0, -1));
  const frame = b.add(fr);
  const parts: number[] = [];
  const gears: [number, P, number][] = [];
  radii.forEach((r, i) => {
    const cells = [C(ax, pos[i]!, 0, 0), C(ax, pos[i]!, 0, 1)];
    if (i === radii.length - 1 && o.arm) for (let k = 0; k <= o.arm; k++) cells.push(C(ax, pos[i]! + k, 0, 2));
    const id = b.add(cells);
    pinAt(b, ax, pos[i]!, 0, -1, 0);
    parts.push(id);
    gears.push([id, at(ax, pos[i]!, 0, 1), r]);
  });
  return { model: finish(b, frame, gears, { ground: o.ground }), parts, frame, pos };
}

/**
 * Compound reduction 1:5^N: P0 an 8 at layer 0; P_i (i ≥ 1) at u = 3i a 40 at layer i−1 and (i < N) an
 * 8 at layer i. Columns go up to layer F−1 = N and hang on pins from a top frame beam at layer F = N+1.
 * Optional arm on P_N at layer N along +u.
 */
export function compound(ax: Axis, N: number, arm = 0): { model: Model; parts: number[]; frame: number } {
  const b = new ModelBuilder();
  const F = N + 1;
  const fr: Cell[] = [];
  for (let u = 0; u <= 3 * N; u++) fr.push(C(ax, u, 0, F));
  const frame = b.add(fr);
  const parts: number[] = [];
  const gears: [number, P, number][] = [];
  for (let i = 0; i <= N; i++) {
    const lo = i === 0 ? 0 : i - 1;
    const cells: Cell[] = [];
    for (let l = lo; l <= F - 1; l++) cells.push(C(ax, 3 * i, 0, l));
    if (i === N) for (let k = 1; k <= arm; k++) cells.push(C(ax, 3 * i + k, 0, F - 1));
    const id = b.add(cells);
    pinAt(b, ax, 3 * i, 0, F, F - 1);
    parts.push(id);
    if (i > 0) gears.push([id, at(ax, 3 * i, 0, i - 1), 2.5]);
    if (i < N) gears.push([id, at(ax, 3 * i, 0, i), 0.5]);
  }
  return { model: finish(b, frame, gears), parts, frame };
}

/** Unwrapped twist of a body about a world axis vector (from its quaternion). */
export class Twist {
  private prev = 0;
  private acc = 0;
  private started = false;
  constructor(private readonly s: Simulation, private readonly body: number, private readonly a: P) {}
  get(): number {
    const t = this.s.bodyTransform(this.body);
    if (!t) return NaN;
    const q = t.q;
    const raw = 2 * Math.atan2(q[0] * this.a[0] + q[1] * this.a[1] + q[2] * this.a[2], q[3]);
    if (!this.started) {
      this.started = true;
      this.acc = raw;
    } else {
      let d = raw - this.prev;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      this.acc += d;
    }
    this.prev = raw;
    return this.acc;
  }
}

export const unitAxis = (ax: Axis): P => {
  const p: P = [0, 0, 0];
  p[ax] = 1;
  return p;
};

export function energyOf(s: Simulation): number {
  const e = s.energy();
  return e.kinetic + e.potential;
}

export function allFinite(s: Simulation): boolean {
  for (const b of s.graph.bodies) {
    const t = s.bodyTransform(b.id);
    if (t && ![...t.p, ...t.q].every(Number.isFinite)) return false;
    const v = s.bodyVelocity(b.id);
    if (v && ![...v.v, ...v.w].every(Number.isFinite)) return false;
  }
  return true;
}

export function maxV(s: Simulation): { v: number; w: number } {
  let v = 0;
  let w = 0;
  for (const b of s.graph.bodies) {
    if (b.fixed) continue;
    const bv = s.bodyVelocity(b.id);
    if (!bv) continue;
    v = Math.max(v, Math.hypot(...bv.v));
    w = Math.max(w, Math.hypot(...bv.w));
  }
  return { v, w };
}
