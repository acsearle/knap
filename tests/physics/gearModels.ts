// Models and measurements shared by the gear tests (DESIGN §5.3 "Gears").
import type { Simulation } from '../../src/physics/sim';
import { ModelBuilder, beam } from '../../src/core/examples';
import { makeCell, setFixRoot, setGear, setGround, validateModel } from '../../src/core/model';
import type { Axis, Cell, Model } from '../../src/core/types';

/** FNV-style hash of every body's pose and velocity every `every` fixed steps over `steps` steps. */
export function trajHash(s: Simulation, steps: number, every: number): string {
  let h = 0x811c9dc5;
  let h2 = 0x12345678;
  const buf = new Float64Array(1);
  const bytes = new Uint8Array(buf.buffer);
  const mix = (x: number) => {
    buf[0] = x;
    for (const b of bytes) {
      h = Math.imul(h ^ b, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ b, 0x5bd1e995) >>> 0;
    }
  };
  for (let i = 1; i <= steps; i++) {
    s.stepFixed(1);
    if (i % every) continue;
    for (const b of s.graph.bodies) {
      const t = s.bodyTransform(b.id);
      const v = s.bodyVelocity(b.id);
      if (!t || !v) {
        mix(-1);
        continue;
      }
      for (const x of [...t.p, ...t.q, ...v.v, ...v.w]) mix(x);
    }
  }
  return h.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------
// Models. Every gear axis is Z unless stated; gears sit on smooth pins (a friction pin welded in the
// frame + a smooth pin in the gear's hub = a revolute joint), as in spikes/gearsim.

export interface GearRig {
  model: Model;
  /** Part ids by name. */
  part: Record<string, number>;
}

/** Apply the gears, then check the model (throws with the first errors). */
export function finish(b: ModelBuilder, root: number, gears: [part: number, pos: [number, number, number], r: number][], o: { ground?: boolean; free?: boolean } = {}): Model {
  let m = b.root(root).build();
  for (const [part, pos, r] of gears) m = setGear(m, part, pos, r);
  if (o.ground) m = setGround(m, true);
  if (o.free) m = setFixRoot(m, false);
  const errs = validateModel(m);
  if (errs.length) throw new Error('invalid gear model: ' + JSON.stringify(errs.slice(0, 3)));
  return m;
}

/** A smooth pin from the frame hole at z = zf into the column's hole at z = zc (same x, y). */
function pinAt(b: ModelBuilder, x: number, y: number, zf: number, zc: number): number {
  return b.add([makeCell(x, y, zf, 'frictionPin', 2), makeCell(x, y, zc, 'pin', 2)]);
}

/** Cells of an arm: holes along Z from (x0, y0, z) `len` further holes in direction (dx, dy). */
function armCells(x0: number, y0: number, z: number, len: number, dx: number, dy: number): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i <= len; i++) out.push(makeCell(x0 + dx * i, y0 + dy * i, z, 'pinHole', 2));
  return out;
}

/**
 * Two meshing gears in layer z = 1: A (radius rA) at the origin, B (rB) at (rA + rB, 0, 1). Each
 * gear's part is a column: a pivot hole in layer 0 (on a smooth pin from the frame beam at z = −1)
 * and the gear in layer 1. (A pin through a small gear's own hub would lie inside its partner's tip
 * disc, which §2.7 rule 1 forbids, so gears turn on a pin in another layer of their part.)
 * Optional arm in layer 2 from B's (or A's) column, `armB` / `armA` further holes along ±X (or
 * straight down with `hanging`).
 */
export function gearPair(rA: number, rB: number, o: { armA?: number; armB?: number; armDir?: 1 | -1; hanging?: boolean } = {}): GearRig {
  const d = rA + rB;
  const b = new ModelBuilder();
  const frame = b.add(beam([0, 0, -1], [d, 0, -1]));
  const dir = o.armDir ?? 1;
  const col = (x: number, arm?: number) => [makeCell(x, 0, 0, 'pinHole', 2), makeCell(x, 0, 1, 'pinHole', 2), ...(arm ? (o.hanging ? armCells(x, 0, 2, arm, 0, -1) : armCells(x, 0, 2, arm, dir, 0)) : [])];
  const A = b.add(col(0, o.armA));
  pinAt(b, 0, 0, -1, 0);
  const B = b.add(col(d, o.armB));
  pinAt(b, d, 0, -1, 0);
  const model = finish(b, frame, [
    [A, [0, 0, 1], rA],
    [B, [d, 0, 1], rB],
  ]);
  return { model, part: { frame, A, B } };
}

/**
 * Compound 1:25: A = 8 at (0, 0, 1); B = 40 at (3, 0, 1) with an 8 at (3, 0, 2) on the same part;
 * C = 40 at (6, 0, 2) with an arm of `arm` further holes in layer 3 along +X. A and B turn on pins
 * from the bottom beam (z = −1) into their pivot holes in layer 0; C hangs on a pin from the top
 * beam (z = 4) into its arm's first hole (layer 3). The frame is a U: beams at z = −1 and z = 4
 * joined by a column at x = −4.
 */
export function compound25(arm = 6): GearRig {
  const b = new ModelBuilder();
  const frameCells: Cell[] = [...beam([-4, 0, -1], [3, 0, -1])];
  for (let z = 0; z <= 3; z++) frameCells.push(makeCell(-4, 0, z, 'pinHole', 2));
  frameCells.push(...beam([-4, 0, 4], [6, 0, 4]));
  const frame = b.add(frameCells);
  const A = b.add([makeCell(0, 0, 0, 'pinHole', 2), makeCell(0, 0, 1, 'pinHole', 2)]);
  pinAt(b, 0, 0, -1, 0);
  const B = b.add([makeCell(3, 0, 0, 'pinHole', 2), makeCell(3, 0, 1, 'pinHole', 2), makeCell(3, 0, 2, 'pinHole', 2)]);
  pinAt(b, 3, 0, -1, 0);
  const C = b.add([makeCell(6, 0, 2, 'pinHole', 2), ...armCells(6, 0, 3, arm, 1, 0)]);
  pinAt(b, 6, 0, 4, 3);
  const model = finish(b, frame, [
    [A, [0, 0, 1], 0.5],
    [B, [3, 0, 1], 2.5],
    [B, [3, 0, 2], 0.5],
    [C, [6, 0, 2], 2.5],
  ]);
  return { model, part: { frame, A, B, C } };
}

/** `n` gears of radius 1 (16 teeth) in a row along X (2 apart) in layer 1, each on a frame pin: an idler chain. Parts G0 … G(n−1). */
export function idlerChain(n = 5): GearRig {
  const b = new ModelBuilder();
  const frame = b.add(beam([0, 0, 0], [2 * (n - 1), 0, 0]));
  const part: Record<string, number> = { frame };
  const gears: [number, [number, number, number], number][] = [];
  for (let i = 0; i < n; i++) {
    const id = b.add([makeCell(2 * i, 0, 1, 'pinHole', 2)]);
    pinAt(b, 2 * i, 0, 0, 1);
    part[`G${i}`] = id;
    gears.push([id, [2 * i, 0, 1], 1]);
  }
  return { model: finish(b, frame, gears), part };
}

/**
 * A locked train: P (x = 0) carries an 8 in layer 1 and a 24 in layer 2, Q (x = 2) a 24 in layer 1
 * and an 8 in layer 2, so P → Q is 1:3 through layer 1 and 3:1 through layer 2. Both turn on pins
 * into pivot holes in layer 0; P carries an arm of `arm` further holes in layer 3 along −X, loading
 * it with gravity.
 */
export function lockedTrain(arm = 4): GearRig {
  const b = new ModelBuilder();
  const frame = b.add(beam([0, 0, -1], [2, 0, -1]));
  const P = b.add([makeCell(0, 0, 0, 'pinHole', 2), makeCell(0, 0, 1, 'pinHole', 2), makeCell(0, 0, 2, 'pinHole', 2), ...armCells(0, 0, 3, arm, -1, 0)]);
  pinAt(b, 0, 0, -1, 0);
  const Q = b.add([makeCell(2, 0, 0, 'pinHole', 2), makeCell(2, 0, 1, 'pinHole', 2), makeCell(2, 0, 2, 'pinHole', 2)]);
  pinAt(b, 2, 0, -1, 0);
  const model = finish(b, frame, [
    [P, [0, 0, 1], 0.5],
    [Q, [2, 0, 2], 0.5],
    [P, [0, 0, 2], 1.5],
    [Q, [2, 0, 1], 1.5],
  ]);
  return { model, part: { frame, P, Q } };
}

/**
 * A free 1:5 gearbox (gearPair(0.5, 2.5)'s layout) not connected to the root: the root is a lone
 * pin hole far above (fixed), so the gearbox falls freely. Parts: root, frame, A (8), B (40).
 */
export function freeGearbox(): GearRig {
  const b = new ModelBuilder();
  const root = b.add([makeCell(0, 40, 0, 'pinHole', 2)]);
  const frame = b.add(beam([0, 0, -1], [3, 0, -1]));
  const A = b.add([makeCell(0, 0, 0, 'pinHole', 2), makeCell(0, 0, 1, 'pinHole', 2)]);
  pinAt(b, 0, 0, -1, 0);
  const B = b.add([makeCell(3, 0, 0, 'pinHole', 2), makeCell(3, 0, 1, 'pinHole', 2)]);
  pinAt(b, 3, 0, -1, 0);
  const model = finish(b, root, [
    [A, [0, 0, 1], 0.5],
    [B, [3, 0, 1], 2.5],
  ]);
  return { model, part: { root, frame, A, B } };
}

/**
 * Swing-arm selector (spikes/gearsim/swing.ts, arm on the sun's axle). Axes along Y, gravity along
 * the axes. Frame: a U of holes in layer y = 0. Sun r 1 on a vertical axle at (0, ·, 0); planet r 1
 * on an arm pivoting on that axle, built at (0, 1, 2) (pitch gap 0.236 to both outputs); outputs
 * r 1 at (±2, 1, 3) on frame pins. The planet meshes output A (x = +2) at arm angle ≈ −8.1° and B at
 * +8.1° from neutral.
 */
export function selector(): GearRig {
  const b = new ModelBuilder();
  const frameCells: Cell[] = [];
  const path: [number, number][] = [];
  for (let z = 3; z >= 0; z--) path.push([-2, z]);
  for (let x = -1; x <= 2; x++) path.push([x, 0]);
  for (let z = 1; z <= 3; z++) path.push([2, z]);
  for (const [x, z] of path) frameCells.push(makeCell(x, 0, z, 'pinHole', 1));
  const frame = b.add(frameCells);
  const sun = b.add([makeCell(0, 1, 0, 'axleHole', 1)]);
  b.add([0, 1, 2, 3].map((y) => makeCell(0, y, 0, 'axle', 1)));
  b.add([makeCell(0, 3, 0, 'axleHole', 1)]);
  const arm = b.add([0, 1, 2].map((z) => makeCell(0, 2, z, 'pinHole', 1)));
  const planet = b.add([makeCell(0, 1, 2, 'pinHole', 1)]);
  b.add([makeCell(0, 1, 2, 'pin', 1), makeCell(0, 2, 2, 'frictionPin', 1)]);
  const outs: number[] = [];
  for (const x of [2, -2]) {
    outs.push(b.add([makeCell(x, 1, 3, 'pinHole', 1)]));
    b.add([makeCell(x, 0, 3, 'frictionPin', 1), makeCell(x, 1, 3, 'pin', 1)]);
  }
  const model = finish(b, frame, [
    [sun, [0, 1, 0], 1],
    [planet, [0, 1, 2], 1],
    [outs[0]!, [2, 1, 3], 1],
    [outs[1]!, [-2, 1, 3], 1],
  ]);
  return { model, part: { frame, sun, arm, planet, A: outs[0]!, B: outs[1]! } };
}

/**
 * A gear sliding along its axle (spikes/gearsim/slide.ts). Frame beam x 0..2 at z = 0. Gear A r 1 at
 * (0, 0, 1) on a frame pin. Gear B r 1 (axle hole) at (2, 0, 2) on an axle (2, 0, −2…3) through the
 * frame hole (2, 0, 0): a cylindrical joint; built at |δ| = 1 (out of mesh).
 */
export function slider(): GearRig {
  const b = new ModelBuilder();
  const frame = b.add(beam([0, 0, 0], [2, 0, 0]));
  const A = b.add([makeCell(0, 0, 1, 'pinHole', 2)]);
  pinAt(b, 0, 0, 0, 1);
  const B = b.add([makeCell(2, 0, 2, 'axleHole', 2)]);
  const shaft = b.add([-2, -1, 0, 1, 2, 3].map((z) => makeCell(2, 0, z, 'axle', 2)));
  const model = finish(b, frame, [
    [A, [0, 0, 1], 1],
    [B, [2, 0, 2], 1],
  ]);
  return { model, part: { frame, A, B, shaft } };
}

/** A single loose gear (a pin hole with a gear of radius r about `axis`), ground on, root free. */
export function looseGear(r: number, axis: Axis = 2): Model {
  const b = new ModelBuilder();
  const id = b.add([makeCell(0, 0, 0, 'pinHole', axis)]);
  return finish(b, id, [[id, [0, 0, 0], r]], { ground: true, free: true });
}

// ---------------------------------------------------------------------------------------------
// Measurements

/** Unwrapped rotation of a body about world +Z since t = 0 (from its displacement), radians. */
export class AngleZ {
  private prev = 0;
  private acc = 0;
  private started = false;
  constructor(
    private readonly s: Simulation,
    private readonly body: number,
    private readonly a: [number, number, number] = [0, 0, 1],
  ) {}
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

/** ω of a body about world axis index `axis` (default Z), rad/s. */
export function omega(s: Simulation, body: number, axis = 2): number {
  const v = s.bodyVelocity(body);
  return v ? v.w[axis]! : NaN;
}

/** Moment of inertia of a body about the world line through `p` along Z. */
export function izAbout(s: Simulation, body: number, p: [number, number, number]): number {
  const mi = s.massInfo(body)!;
  const dx = mi.com[0] - p[0];
  const dy = mi.com[1] - p[1];
  return mi.inertia[8]! + mi.mass * (dx * dx + dy * dy);
}

export function totalEnergy(s: Simulation): number {
  const e = s.energy();
  return e.kinetic + e.potential;
}

/** Largest |phase error| (teeth) over the engaged meshes now. */
export function phaseNow(s: Simulation): number {
  let m = 0;
  for (const st of s.meshStates()) m = Math.max(m, Math.abs(st.phaseErrorTeeth));
  return m;
}

/** Max |ω| over the live dynamic bodies, rad/s. */
export function maxOmega(s: Simulation): number {
  let w = 0;
  for (const b of s.graph.bodies) {
    if (b.fixed) continue;
    const v = s.bodyVelocity(b.id);
    if (v) w = Math.max(w, Math.hypot(...v.w));
  }
  return w;
}
