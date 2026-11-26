// Connection and mate rules (DESIGN.md §2.2, §2.3). Pure.
import type { Axis, Cell, Dir, HoleKind, Kind, MaleKind, MateType, Vec3i } from './types';

export const KINDS: readonly Kind[] = ['pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'];
export const HOLE_KINDS: readonly HoleKind[] = ['pinHole', 'axleHole'];
export const MALE_KINDS: readonly MaleKind[] = ['axle', 'pin', 'frictionPin'];
export const AXES: readonly Axis[] = [0, 1, 2];

export function isKind(k: unknown): k is Kind {
  return typeof k === 'string' && (KINDS as readonly string[]).includes(k);
}
export function isAxis(a: unknown): a is Axis {
  return a === 0 || a === 1 || a === 2;
}
export function isMale(kind: Kind): kind is MaleKind {
  return kind === 'axle' || kind === 'pin' || kind === 'frictionPin';
}
export function isHole(kind: Kind): kind is HoleKind {
  return kind === 'pinHole' || kind === 'axleHole';
}

/** The six unit vectors, index = Dir (+X, −X, +Y, −Y, +Z, −Z). */
export const DIRS: readonly Vec3i[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function axisOfDir(dir: Dir): Axis {
  return (dir >> 1) as Axis;
}

/** The opposite direction (+X <-> −X, …). */
export function oppositeDir(dir: Dir): Dir {
  return (dir ^ 1) as Dir;
}

/**
 * Direction from a to b if they are face-adjacent (differ by exactly one unit along one axis),
 * else null.
 */
export function dirBetween(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): Dir | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  // Exactly one component is ±1 and the others are exactly 0 (non-integer or NaN input → null).
  if (dy === 0 && dz === 0) {
    if (dx === 1) return 0;
    if (dx === -1) return 1;
  } else if (dx === 0 && dz === 0) {
    if (dy === 1) return 2;
    if (dy === -1) return 3;
  } else if (dx === 0 && dy === 0) {
    if (dz === 1) return 4;
    if (dz === -1) return 5;
  }
  return null;
}

/**
 * In-part connection (§2.2): would cells a and b, if in the same part, be connected?
 * False if they are not face-adjacent.
 *   hole–hole: always; male–male: iff both axes ∥ n; male–hole: iff male axis ∥ n and hole axis ⟂ n.
 */
export function connects(a: Cell, b: Cell): boolean {
  const dir = dirBetween(a, b);
  if (dir === null) return false;
  const n = axisOfDir(dir);
  const ma = isMale(a.kind);
  const mb = isMale(b.kind);
  if (!ma && !mb) return true;
  if (ma && mb) return a.axis === n && b.axis === n;
  const male = ma ? a : b;
  const hole = ma ? b : a;
  return male.axis === n && hole.axis !== n;
}

/**
 * Mate table (§2.3). The friction pin entry lives in this one constant so it can later become
 * revolute-with-friction.
 */
export const FRICTION_PIN_IN_PIN_HOLE: MateType = 'weld';

export const MATE_TABLE: Readonly<Record<MaleKind, Readonly<Record<HoleKind, MateType | null>>>> = {
  axle: { pinHole: 'cylindrical', axleHole: 'weld' },
  pin: { pinHole: 'revolute', axleHole: null },
  frictionPin: { pinHole: FRICTION_PIN_IN_PIN_HOLE, axleHole: null },
};

/** Mate type of a male kind inside a hole kind; null if incompatible or kinds are not male/hole. */
export function mateType(male: Kind, hole: Kind): MateType | null {
  if (!isMale(male) || !isHole(hole)) return null;
  return MATE_TABLE[male][hole];
}

/**
 * Can two cells of *different* parts share one position? Returns the mate type if so, else a
 * reason. Order-independent. Positions are not compared (caller guarantees they coincide).
 */
export function shareResult(a: Cell, b: Cell): { ok: true; mate: MateType } | { ok: false; reason: string } {
  const ma = isMale(a.kind);
  const mb = isMale(b.kind);
  if (ma && mb) return { ok: false, reason: 'two pins/axles cannot share a cell' };
  if (!ma && !mb) return { ok: false, reason: 'two holes cannot share a cell' };
  const male = ma ? a : b;
  const hole = ma ? b : a;
  if (male.axis !== hole.axis) return { ok: false, reason: `${kindLabel(male.kind)} is not coaxial with the ${kindLabel(hole.kind)}` };
  const mate = mateType(male.kind, hole.kind);
  if (!mate) return { ok: false, reason: `${kindLabel(male.kind)} does not fit an ${kindLabel(hole.kind)}` };
  return { ok: true, mate };
}

const KIND_LABELS: Record<Kind, string> = {
  pinHole: 'pin hole',
  axleHole: 'axle hole',
  axle: 'axle',
  pin: 'pin',
  frictionPin: 'friction pin',
};

/** Human-readable kind name ("pin hole", "friction pin", …). */
export function kindLabel(kind: Kind): string {
  return KIND_LABELS[kind];
}

/** 'X' | 'Y' | 'Z'. */
export function axisLabel(axis: Axis): 'X' | 'Y' | 'Z' {
  return (['X', 'Y', 'Z'] as const)[axis];
}
