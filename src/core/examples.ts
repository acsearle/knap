// Built-in examples (DESIGN.md §8), built with the core API. Also small cell-list helpers
// (beam, pin, axle, bush, …) reused by tests.
//
// Layout conventions: mechanisms move in the XY plane (holes along Z, gravity −Y); every link
// sits in its own Z layer where it could otherwise sweep through a neighbour, and every pin is
// exactly as long as the stack of layers it joins.
import { addPart, emptyModel, makeCell, setFixRoot, setGround, setRoot } from './model';
import type { Axis, Cell, HoleKind, Kind, MaleKind, Model } from './types';

export type P3 = readonly [number, number, number];

/** Grid points from `from` to `to` inclusive; they must differ along at most one axis. */
export function runBetween(from: P3, to: P3): P3[] {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const nonZero = d.filter((v) => v !== 0).length;
  if (nonZero > 1) throw new Error(`run ${JSON.stringify(from)}→${JSON.stringify(to)} is not axis-aligned`);
  const n = Math.max(...d.map(Math.abs));
  const step = d.map(Math.sign);
  const out: P3[] = [];
  for (let i = 0; i <= n; i++) out.push([from[0] + step[0]! * i, from[1] + step[1]! * i, from[2] + step[2]! * i]);
  return out;
}

/** Axis along which `from`→`to` runs (null if from == to). */
function runAxis(from: P3, to: P3): Axis | null {
  if (from[0] !== to[0]) return 0;
  if (from[1] !== to[1]) return 1;
  if (from[2] !== to[2]) return 2;
  return null;
}

/** A straight row of holes from `from` to `to` inclusive, all with axis `holeAxis` (default Z). */
export function holes(from: P3, to: P3, holeAxis: Axis = 2, kind: HoleKind = 'pinHole'): Cell[] {
  return runBetween(from, to).map((p) => makeCell(p[0], p[1], p[2], kind, holeAxis));
}

/** Liftarm: a straight row of pin holes (axis default Z). */
export function beam(from: P3, to: P3, holeAxis: Axis = 2): Cell[] {
  return holes(from, to, holeAxis, 'pinHole');
}

/**
 * Liftarm through several corner points: beamPath([[4,2,1],[4,0,1],[6,0,1]]) is an L.
 * Corners are shared between consecutive runs.
 */
export function beamPath(points: readonly P3[], holeAxis: Axis = 2): Cell[] {
  const out: Cell[] = [];
  points.forEach((p, i) => {
    if (i === 0) {
      out.push(makeCell(p[0], p[1], p[2], 'pinHole', holeAxis));
      return;
    }
    out.push(...beam(points[i - 1]!, p, holeAxis).slice(1));
  });
  return out;
}

/**
 * Straight male rod from `from` to `to` inclusive along their common axis. For a single cell
 * (from == to) pass `axis`.
 */
export function rod(kind: MaleKind, from: P3, to: P3, axis?: Axis): Cell[] {
  const a = runAxis(from, to) ?? axis;
  if (a === undefined) throw new Error('rod: a single-cell rod needs an explicit axis');
  if (axis !== undefined && axis !== a) throw new Error('rod: axis does not match from→to');
  return runBetween(from, to).map((p) => makeCell(p[0], p[1], p[2], kind, a));
}

/** Smooth (frictionless) pin from `from` to `to`. */
export function pin(from: P3, to: P3, axis?: Axis): Cell[] {
  return rod('pin', from, to, axis);
}

/** Friction pin from `from` to `to`. */
export function frictionPin(from: P3, to: P3, axis?: Axis): Cell[] {
  return rod('frictionPin', from, to, axis);
}

/** Cross axle from `from` to `to`. */
export function axle(from: P3, to: P3, axis?: Axis): Cell[] {
  return rod('axle', from, to, axis);
}

/** Bush: a single axle hole. */
export function bush(pos: P3, axis: Axis): Cell[] {
  return [makeCell(pos[0], pos[1], pos[2], 'axleHole', axis)];
}

/** A single cell. */
export function cell(pos: P3, kind: Kind, axis: Axis): Cell {
  return makeCell(pos[0], pos[1], pos[2], kind, axis);
}

/** Incremental model construction through addPart (so every step is validated; throws on error). */
export class ModelBuilder {
  model: Model = emptyModel();

  /** Add a part; returns its id. Colour defaults per DEFAULT_COLORS. */
  add(cells: readonly Cell[], color?: string): number {
    const r = addPart(this.model, cells, color);
    this.model = r.model;
    return r.partId;
  }

  root(partId: number): this {
    this.model = setRoot(this.model, partId);
    return this;
  }

  build(): Model {
    return this.model;
  }
}

/** Example colour palette (solid; darkest is dark grey so outlines stay visible). */
export const EXAMPLE_COLORS = {
  frame: '#5f6468',
  red: '#c8433a',
  yellow: '#e0b43c',
  blue: '#3b74c4',
  green: '#4c9a57',
  orange: '#e07b2e',
  white: '#e8e8e4',
} as const;

const C = EXAMPLE_COLORS;

// ---------------------------------------------------------------------------------------------
// The examples

/** 1. Fixed 3-hole beam, 5-hole link on a smooth pin at the beam's end, released horizontal. */
function pendulum(): Model {
  const b = new ModelBuilder();
  const frame = b.add(beam([-2, 0, 0], [0, 0, 0]), C.frame);
  b.add(beam([0, 0, 1], [4, 0, 1]), C.red);
  b.add(pin([0, 0, 0], [0, 0, 1]));
  return b.root(frame).build();
}

/** 2. Fixed beam + links of 5, 4, 3 holes joined end to end, horizontal, each link one layer further out. */
function triplePendulum(): Model {
  const b = new ModelBuilder();
  const frame = b.add(beam([-2, 0, 0], [0, 0, 0]), C.frame);
  b.add(beam([0, 0, 1], [4, 0, 1]), C.red);
  b.add(beam([4, 0, 2], [7, 0, 2]), C.yellow);
  b.add(beam([7, 0, 3], [9, 0, 3]), C.blue);
  b.add(pin([0, 0, 0], [0, 0, 1]));
  b.add(pin([4, 0, 1], [4, 0, 2]));
  b.add(pin([7, 0, 2], [7, 0, 3]));
  return b.root(frame).build();
}

/**
 * 3. Four-bar: ground pivots (0,0) and (6,0); crank 2 up from (0,0) to (0,2); coupler 4 across
 * to (4,2); L-shaped rocker from (4,2) down to (4,0) and over to (6,0). Link lengths 2, 4,
 * 2√2 against ground 6 (not a parallelogram). Gravity has a non-zero moment about the single
 * DOF at t=0, so it moves when played.
 */
function fourBar(): Model {
  const b = new ModelBuilder();
  const ground = b.add(beam([0, 0, 0], [6, 0, 0]), C.frame);
  b.add(beam([0, 0, 1], [0, 2, 1]), C.red); // crank, layer 1
  b.add(beam([0, 2, 2], [4, 2, 2]), C.yellow); // coupler, layer 2
  b.add(beamPath([[4, 2, 1], [4, 0, 1], [6, 0, 1]]), C.blue); // rocker, layer 1
  b.add(pin([0, 0, 0], [0, 0, 1])); // ground–crank
  b.add(pin([0, 2, 1], [0, 2, 2])); // crank–coupler
  b.add(pin([4, 2, 1], [4, 2, 2])); // rocker–coupler
  b.add(pin([6, 0, 0], [6, 0, 1])); // ground–rocker
  return b.root(ground).build();
}

/**
 * 4. Parallelogram: horizontal ground (0,0)–(3,0); two equal L-shaped cranks hanging from its ends,
 * pivot to pivot (2,−2), so they start 45° from vertical (top-left crank in front, layer +1;
 * right one behind, layer −1); horizontal coupler (2,−2)–(5,−2) in the ground's layer. The cranks
 * swing between ±45° and are vertical (the rectangle) at the bottom; energy never lets them reach
 * horizontal, where all four pivots would be collinear (the change point to the crossed branch).
 */
function parallelogram(): Model {
  const b = new ModelBuilder();
  const ground = b.add(beam([0, 0, 0], [3, 0, 0]), C.frame);
  b.add(beamPath([[0, 0, 1], [0, -2, 1], [2, -2, 1]]), C.red); // crank, layer +1
  b.add(beamPath([[3, 0, -1], [3, -2, -1], [5, -2, -1]]), C.red); // crank, layer −1
  b.add(beam([2, -2, 0], [5, -2, 0]), C.green); // coupler, layer 0
  b.add(pin([0, 0, 0], [0, 0, 1]));
  b.add(pin([3, 0, -1], [3, 0, 0]));
  b.add(pin([2, -2, 0], [2, -2, 1]));
  b.add(pin([5, -2, -1], [5, -2, 0]));
  return b.root(ground).build();
}

/**
 * 5. Fixed flat beam (holes vertical) at y=0, x=0..4, plus one hole along Z on top of its end.
 *    - x=0: vertical axle y=−2..4 with a 2-hole arm (bush + pin hole) at y=3, two cells above
 *      the beam: drops 2 and stops on it.
 *    - (4,1): horizontal axle along Z, z=−2..2, through the Z hole, captured by a 2-hole arm at
 *      z=1 and a bush at z=−1: spins only. The arm starts horizontal, so gravity swings it.
 */
function slidingAxle(): Model {
  const b = new ModelBuilder();
  const frame = b.add([...beam([0, 0, 0], [4, 0, 0], 1), cell([4, 1, 0], 'pinHole', 2)], C.frame);
  b.add(axle([0, -2, 0], [0, 4, 0]));
  b.add([cell([0, 3, 0], 'axleHole', 1), cell([0, 3, 1], 'pinHole', 1)], C.red);
  b.add(axle([4, 1, -2], [4, 1, 2]));
  b.add([cell([4, 1, 1], 'axleHole', 2), cell([5, 1, 1], 'pinHole', 2)], C.blue);
  b.add(bush([4, 1, -1], 2), C.blue);
  return b.root(frame).build();
}

/** 6. Two beams joined by two smooth pins (so rigid) hanging as one pendulum from a fixed third. */
function weldTest(): Model {
  const b = new ModelBuilder();
  const frame = b.add(beam([-2, 0, 0], [0, 0, 0]), C.frame);
  b.add(beam([0, 0, 1], [4, 0, 1]), C.red);
  b.add(beam([2, 0, 2], [5, 0, 2]), C.yellow);
  b.add(pin([0, 0, 0], [0, 0, 1])); // pivot
  b.add(pin([2, 0, 1], [2, 0, 2]));
  b.add(pin([4, 0, 1], [4, 0, 2]));
  return b.root(frame).build();
}

/**
 * 7. Frame: top beam (−2..0, 0), post down x=−2, foot to (0,−6), and a peg sticking out along +Z
 * from (0,−5) into layers 1–2. Double pendulum: 4-hole link in layer 1 from the pivot (0,0),
 * 4-hole link in layer 2 from (3,0). The peg is out of reach of the upper link but in the lower
 * link's path. A loose 3-hole beam starts 3 above the frame's top beam and falls onto it.
 */
function collision(): Model {
  const b = new ModelBuilder();
  const frame = b.add(
    [
      ...beamPath([[0, 0, 0], [-2, 0, 0], [-2, -6, 0], [0, -6, 0]]),
      cell([0, -5, 0], 'pinHole', 0), // perpendicular block carrying the peg
      ...axle([0, -5, 1], [0, -5, 2]), // peg
    ],
    C.frame,
  );
  b.add(beam([0, 0, 1], [3, 0, 1]), C.red);
  b.add(beam([3, 0, 2], [6, 0, 2]), C.yellow);
  b.add(pin([0, 0, 0], [0, 0, 1]));
  b.add(pin([3, 0, 1], [3, 0, 2]));
  b.add(beam([-2, 3, 0], [0, 3, 0]), C.green); // loose part
  return b.root(frame).build();
}

/**
 * 8. Crank wheel: an inverted-T upright (base y = −10, post up to the hub at (0, 0)) in layer 0; an
 * r = 2.5 wheel in layer 1 on a smooth pin at (0, 0) with a crank hole at (2, 2) (joined to the hub
 * by the disc, §2.6 rule 1); a 7-hole link in layer 2 hanging from a smooth pin in the crank hole.
 * The crank starts 45° above horizontal, so the link's weight turns the wheel, which rocks about
 * crank-down for several seconds. No ground. The upright is tall enough that the link, hanging
 * crank-down (lowest end y ≈ −9.3), stays above the base, inside the view fitted at load.
 */
function crankWheel(): Model {
  const b = new ModelBuilder();
  const frame = b.add([...beam([-2, -10, 0], [2, -10, 0]), ...beam([0, -9, 0], [0, 0, 0])], C.frame);
  b.add([makeCell(0, 0, 1, 'pinHole', 2, 2.5), makeCell(2, 2, 1, 'pinHole', 2)], C.yellow); // wheel + crank hole
  b.add(beam([2, 2, 2], [2, -4, 2]), C.red); // link
  b.add(pin([0, 0, 0], [0, 0, 1])); // axle of the wheel
  b.add(pin([2, 2, 1], [2, 2, 2])); // crank pin
  return b.root(frame).build();
}

/**
 * 9. Cart: ground on, root free. Chassis = two 9-hole beams (z = 0 and z = 2, holes along Z)
 * bridged by pin holes at both ends (x = 0 and 8, z = 1), with a post rising from the middle of the
 * front beam (x = 4, z = 0, up to y = 7). Four wheels (r = 1.5, single pin holes at z = −1 and
 * z = 3, x = 0 and 8), each on its own axle: a friction pin welded in the chassis plus a smooth pin
 * in the hub. A weighted arm in layer 1 (a 7-hole beam with six holes around its end, a 3×3 block)
 * hangs on a smooth pin from the top of the post, starting horizontal: it falls and swings, clear
 * of the ground, the bridges and the wheels, and the cart rolls back and forth under it until
 * joint friction brings both to rest. (Arm and post sized so the chassis travels ≈ 2.3 units in
 * the first seconds, enough to read against the wheels' marks and the contact shadow; the first,
 * shorter arm gave 1.5.)
 */
function cartExample(): Model {
  const b = new ModelBuilder();
  const chassis = b.add(
    [
      ...beam([0, 0, 0], [8, 0, 0]),
      ...beam([4, 1, 0], [4, 7, 0]),
      cell([0, 0, 1], 'pinHole', 2),
      cell([8, 0, 1], 'pinHole', 2),
      ...beam([0, 0, 2], [8, 0, 2]),
    ],
    C.frame,
  );
  for (const x of [0, 8])
    for (const [zc, zw] of [[0, -1], [2, 3]] as const) {
      b.add([makeCell(x, 0, zc, 'frictionPin', 2), makeCell(x, 0, zw, 'pin', 2)]); // axle
      b.add([makeCell(x, 0, zw, 'pinHole', 2, 1.5)], C.blue); // wheel
    }
  const arm = [...beam([4, 7, 1], [10, 7, 1])];
  for (const x of [8, 9, 10]) for (const y of [6, 8]) arm.push(cell([x, y, 1], 'pinHole', 2));
  b.add(arm, C.red);
  b.add(pin([4, 7, 0], [4, 7, 1])); // pivot
  return setFixRoot(setGround(b.root(chassis).build(), true), false);
}

/**
 * 10. Gear train (§2.7): no ground, fixed root, every gear axis along Z.
 * - Frame (fixed), all in layer −1 behind the mechanism: an upright x = 0 from a foot at y = −8
 *   (x = −2…2) up to y = 3, and a top beam along y = 3 out to x = 2. Tall enough that the arm,
 *   hanging at rest (lowest point y ≈ −7.2), stays inside the view fitted at load.
 * - Arm (part 3): a 40-tooth gear at (0, 0, 1) on a smooth pin from the frame into the first hole
 *   of a 7-hole arm in layer 0 that starts horizontal along −X, with a 3 × 3 weight at its end. The
 *   arm only ever swings through the lower half (it cannot gain energy), clear of everything above
 *   y = 1.5 (corner of the weight).
 * - Pinion (part 2), on the line of centres straight above at (0, 3): a balanced 3-hole pointer in
 *   layer 0 (its middle hole on a smooth pin from the frame), an 8-tooth gear in layer 1 (meshing
 *   the 40) and a second 8-tooth gear in layer 2; the pinion turns on its pointer's hole. (Built
 *   when §2.7 rule 1 still forbade a pin of another part in a meshing 8's hub; since review m8 that
 *   is allowed — DEVIATIONS "Gears" — but the layout is kept.)
 * - Output (part 4): a 24-tooth gear at (2, 3, 2) meshing the second 8, on a long pin from the
 *   frame (a friction pin in the frame, smooth in the 24's hub), and a balanced 3-hole pointer in
 *   layer 3 in front of it.
 * 40 → 8 is 5:1 the other way, 8 → 24 is 1:3 the other way again: the pinion turns 5× as fast as
 * the arm, opposite to it, and the output 5/3 as fast, the same way as the arm. Each gear and its
 * pointer are one part. The pinion pointer's sweep (radius 1.47 about (0, 3), layer 0) clears the
 * output pin (radius 0.29 at distance 2) by 0.24.
 */
function gearTrain(): Model {
  const b = new ModelBuilder();
  const frame = b.add([...beam([-2, -8, -1], [2, -8, -1]), ...beam([0, -7, -1], [0, 3, -1]), ...beam([1, 3, -1], [2, 3, -1])], C.frame);
  // Pinion first (gears are checked as each part is added: the 8s go in before the larger gears
  // whose tips reach their hubs).
  b.add([...beam([-1, 3, 0], [1, 3, 0]), makeCell(0, 3, 1, 'pinHole', 2, 0.5, true), makeCell(0, 3, 2, 'pinHole', 2, 0.5, true)], C.blue);
  const arm = [...beam([0, 0, 0], [-6, 0, 0]), makeCell(0, 0, 1, 'pinHole', 2, 2.5, true)];
  for (const x of [-4, -5, -6]) for (const y of [-1, 1]) arm.push(cell([x, y, 0], 'pinHole', 2)); // weight
  b.add(arm, C.red);
  b.add([makeCell(2, 3, 2, 'pinHole', 2, 1.5, true), ...beam([2, 2, 3], [2, 4, 3])], C.yellow);
  b.add(pin([0, 0, -1], [0, 0, 0])); // arm pivot
  b.add(pin([0, 3, -1], [0, 3, 0])); // pinion pivot
  b.add([makeCell(2, 3, -1, 'frictionPin', 2), ...pin([2, 3, 0], [2, 3, 2])]); // output pivot
  return b.root(frame).build();
}

export interface Example {
  /** Stable identifier (used by loadExample and tests). */
  name: string;
  title: string;
  description: string;
  build(): Model;
}

export const EXAMPLES: readonly Example[] = [
  {
    name: 'pendulum',
    title: 'Pendulum',
    description: 'A 5-hole link on a smooth pin at the end of a fixed 3-hole beam, released horizontal.',
    build: pendulum,
  },
  {
    name: 'triple-pendulum',
    title: 'Triple pendulum',
    description: 'Links of 5, 4 and 3 holes joined end to end by smooth pins, each in its own layer, released horizontal.',
    build: triplePendulum,
  },
  {
    name: 'four-bar',
    title: 'Four-bar linkage',
    description: 'Crank, coupler and L-shaped rocker on four smooth pins over a fixed ground beam; one degree of freedom, starts out of balance.',
    build: fourBar,
  },
  {
    name: 'parallelogram',
    title: 'Parallelogram linkage',
    description: 'Four-bar with equal opposite sides: two L-shaped cranks released 45° from vertical, keeping the coupler parallel to the ground as they swing.',
    build: parallelogram,
  },
  {
    name: 'sliding-axle',
    title: 'Sliding axle',
    description: 'A vertical axle through a fixed beam with a stop two cells up (drops and stops), and a horizontal axle held between two stops whose off-centre arm swings (spins, cannot slide).',
    build: slidingAxle,
  },
  {
    name: 'weld-test',
    title: 'Weld test',
    description: 'Two beams joined by two smooth pins form one rigid body, swinging as one pendulum from a fixed beam.',
    build: weldTest,
  },
  {
    name: 'collision',
    title: 'Collision',
    description: 'A double pendulum whose lower link strikes a peg on the fixed frame, and a loose beam that falls onto the frame.',
    build: collision,
  },
  {
    name: 'crank-wheel',
    title: 'Crank wheel',
    description: 'A wheel of radius 2.5 on a smooth pin in a fixed upright, with a link hanging from a crank hole: the link turns the wheel, which rocks to rest crank-down.',
    build: crankWheel,
  },
  {
    name: 'cart',
    title: 'Cart',
    description: 'A free cart on the ground (nothing fixed): four wheels of radius 1.5 under a chassis with a weighted arm on a smooth pin. The arm falls and swings, and the cart rolls back and forth under it.',
    build: cartExample,
  },
  {
    name: 'gear-train',
    title: 'Gear train',
    description: 'A 40-tooth gear with an off-balance arm drives an 8-tooth pinion (5:1), whose second 8-tooth gear drives a 24 (1:3). The arm falls and swings; the pinion pointer whirls five times as fast the other way, the third pointer turns 5/3 as fast the same way.',
    build: gearTrain,
  },
];

export function exampleByName(name: string): Example | undefined {
  return EXAMPLES.find((e) => e.name === name);
}

/** Build an example by name; throws for an unknown name. */
export function buildExample(name: string): Model {
  const e = exampleByName(name);
  if (!e) throw new Error(`unknown example ${JSON.stringify(name)} (known: ${EXAMPLES.map((x) => x.name).join(', ')})`);
  return e.build();
}
