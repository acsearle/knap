// spike-mesh helpers: knap models with gears (rims), built with src/core, run in the GEARSIM copy
// of the Simulation (gearsim.ts). Not product code.
import { ModelBuilder, beam } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround, setRim, validateModel } from '../../src/core/model';
import type { Cell, Model } from '../../src/core/types';
import { G, PITCH, Simulation } from './gearsim';
import type { SimOptions } from './gearsim';
import type { Vec3 } from '../../src/physics/math';

export { G, PITCH, Simulation };
export type { SimOptions };

export interface GearCol {
  x: number;
  y?: number;
  /** Pitch radius per layer z = 1, 2, …; null = a plain pin hole (spacer). */
  col: (number | null)[];
  /** A liftarm of `len` further holes in the layer after the column, along +x (dir 1) or −x. */
  arm?: { len: number; dir?: 1 | -1; along?: 'x' | 'y' };
  /** No pin from the frame (the column is carried by something else). */
  noPin?: boolean;
}

/**
 * Rims on hole cells; r = 0.5 is not allowed by the model rules (RIM_MIN 1), so it is written into
 * the cell directly (bypassing setRim; the r 0.5 disc is the hub's own barrel and overlaps nothing).
 */
export function putRims(m: Model, rims: { part: number; pos: [number, number, number]; r: number }[]): Model {
  for (const q of rims) if (q.r >= 1) m = setRim(m, q.part, q.pos, q.r);
  const small = rims.filter((q) => q.r < 1);
  if (small.length) {
    m = { ...m, version: 2, parts: m.parts.map((p) => ({ ...p, cells: p.cells.map((c) => {
      const s = small.find((q) => q.part === p.id && q.pos[0] === c.x && q.pos[1] === c.y && q.pos[2] === c.z);
      return s ? makeCell(c.x, c.y, c.z, c.kind, c.axis, s.r) : c;
    }) })) };
  }
  const errs = validateModel(m).filter((e) => !/rim must be|steps of/.test(e.message));
  if (errs.length) throw new Error('invalid model: ' + JSON.stringify(errs.slice(0, 3)));
  return m;
}

/**
 * A gear train in a fixed frame: frame = a beam at z = 0 (holes along Z) from x0 to x1 at y = 0;
 * every column stands on a pin from the frame (friction pin in the frame hole + smooth pin in the
 * column's first hole: a revolute). Returns the model and each column's part id.
 */
export function train(cols: GearCol[], o: { frameFrom?: number; frameTo?: number; ground?: boolean; free?: boolean } = {}): { model: Model; parts: number[]; frame: number } {
  const b = new ModelBuilder();
  const xs = cols.map((c) => c.x);
  const x0 = o.frameFrom ?? Math.min(...xs);
  const x1 = o.frameTo ?? Math.max(...xs);
  const frame = b.add(beam([x0, 0, 0], [x1, 0, 0]));
  const parts: number[] = [];
  const rims: { part: number; pos: [number, number, number]; r: number }[] = [];
  for (const c of cols) {
    const y = c.y ?? 0;
    const cells: Cell[] = c.col.map((_, i) => makeCell(c.x, y, i + 1, 'pinHole', 2));
    if (c.arm) {
      const z = c.col.length + 1;
      const d = c.arm.dir ?? 1;
      for (let i = 0; i <= c.arm.len; i++) cells.push(c.arm.along === 'y' ? makeCell(c.x, y + d * i, z, 'pinHole', 2) : makeCell(c.x + d * i, y, z, 'pinHole', 2));
    }
    const id = b.add(cells);
    parts.push(id);
    c.col.forEach((r, i) => {
      if (r !== null) rims.push({ part: id, pos: [c.x, y, i + 1], r });
    });
    if (!c.noPin) b.add([makeCell(c.x, y, 0, 'frictionPin', 2), makeCell(c.x, y, 1, 'pin', 2)]);
  }
  let m = b.root(frame).build();
  m = putRims(m, rims);
  if (o.ground) m = setGround(m, true);
  if (o.free) m = setFixRoot(m, false);
  return { model: m, parts, frame };
}

/** A crane: an arm of `arm` further holes on the output of 1:1 / 1:5 / 1:25 / 1:125 (ratios = ω_j/ω_input). */
export function crane(name: string, arm: number): { cols: GearCol[]; ratios: number[] } {
  const a = { len: arm };
  if (name === '1:1') return { cols: [{ x: 0, col: [1] }, { x: 2, col: [1], arm: a }], ratios: [1, -1] };
  if (name === '1:5') return { cols: [{ x: 0, col: [0.5] }, { x: 3, col: [2.5], arm: a }], ratios: [1, -0.2] };
  if (name === '1:25') return { cols: [{ x: 0, col: [0.5] }, { x: 3, col: [2.5, 0.5] }, { x: 6, col: [null, 2.5], arm: a }], ratios: [1, -0.2, 0.04] };
  if (name === '1:125')
    return { cols: [{ x: 0, col: [0.5] }, { x: 3, col: [2.5, 0.5] }, { x: 6, col: [null, 2.5, 0.5] }, { x: 9, col: [null, null, 2.5], arm: a }], ratios: [1, -0.2, 0.04, -0.008] };
  throw new Error(name);
}

/** Unwrapped angle tracker about world axis a (default +Z) of a body. */
export class Angle {
  prev = 0;
  acc = 0;
  init = false;
  constructor(public s: Simulation, public body: number, public a: Vec3 = [0, 0, 1]) {}
  get(): number {
    const t = this.s.bodyTransform(this.body);
    if (!t) return NaN;
    const q = t.q;
    const raw = 2 * Math.atan2(q[0] * this.a[0] + q[1] * this.a[1] + q[2] * this.a[2], q[3]);
    if (!this.init) {
      this.init = true;
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

export function omegaZ(s: Simulation, body: number): number {
  const v = s.bodyVelocity(body);
  return v ? v.w[2] : NaN;
}

/** Moment of inertia of a body about the world line through `p` along Z. */
export function izAbout(s: Simulation, body: number, p: Vec3): number {
  const mi = s.massInfo(body)!;
  const dx = mi.com[0] - p[0];
  const dy = mi.com[1] - p[1];
  return mi.inertia[8]! + mi.mass * (dx * dx + dy * dy);
}

export function energyTotal(s: Simulation): number {
  const e = s.energy();
  return e.kinetic + e.potential;
}

/** Largest phase error (teeth) over the meshes since the start, and the current one. */
export function phaseTeeth(s: Simulation): { max: number; now: number } {
  let max = 0;
  let now = 0;
  for (const m of s.meshes) {
    max = Math.max(max, m.maxE / PITCH);
    if (m.engaged) now = Math.max(now, Math.abs(m.e) / PITCH);
  }
  return { max, now };
}

/** Max |ω| (rad/s) over the bodies carrying a gear. */
export function maxGearOmega(s: Simulation): number {
  let w = 0;
  const seen = new Set<number>();
  for (const g of s.gears) {
    if (seen.has(g.body)) continue;
    seen.add(g.body);
    const v = s.bodyVelocity(g.body);
    if (v) w = Math.max(w, Math.hypot(...v.w));
  }
  return w;
}

/** Histogram of the rotation per world step (rad) of the fastest gear body, collected via onWorldStep. */
export class RotHist {
  edges = [0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 0.79];
  counts = new Array(this.edges.length + 1).fill(0);
  max = 0;
  n = 0;
  attach(s: Simulation): void {
    s.onWorldStep = (q) => this.add(maxGearOmega(q) * q.h);
  }
  add(x: number): void {
    this.n++;
    this.max = Math.max(this.max, x);
    let i = 0;
    while (i < this.edges.length && x >= this.edges[i]!) i++;
    this.counts[i]++;
  }
  frac(above: number): number {
    let c = 0;
    this.edges.forEach((e, i) => {
      if (e >= above) c += this.counts[i + 1];
    });
    return c / Math.max(1, this.n);
  }
  str(): string {
    const lab = ['<' + this.edges[0]];
    for (let i = 0; i < this.edges.length; i++) lab.push('≥' + this.edges[i]);
    return lab.map((l, i) => `${l}:${((100 * this.counts[i]) / Math.max(1, this.n)).toFixed(1)}%`).filter((x) => !x.endsWith(':0.0%')).join(' ') + ` max ${this.max.toFixed(3)}`;
  }
}

export const f = (x: number, d = 4): string => (x === 0 || (Math.abs(x) >= 1e-3 && Math.abs(x) < 1e5) ? x.toFixed(d) : x.toExponential(2));
export const out = (...a: unknown[]): void => console.log(...a);
export const now = (): number => performance.now();
