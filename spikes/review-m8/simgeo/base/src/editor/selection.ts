// Operations on the selected part (DESIGN.md §7.2): screen-aligned move, view-axis rotate,
// duplicate, delete. Pure.
import {
  addPart,
  axisLabel,
  cellsAt,
  discCells,
  hasRim,
  kindLabel,
  makeCell,
  validateModel,
  movePart,
  partById,
  removePart,
  rotateAxis,
  rotatePart,
  rotateVec,
  shareResult,
} from '../core';
import type { Axis, Cell, Model, Vec3i } from '../core';
import type { Vec3 } from './picking';

export type OpResult =
  | { ok: true; model: Model; message?: string; /** part to select afterwards */ partId?: number }
  | { ok: false; message: string };

/**
 * Camera basis in world space: `right` and `up` are the screen's +x and +y directions, `forward`
 * the view direction (from the eye into the scene). Need not be exactly orthonormal.
 */
export interface CameraBasis {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

export type MoveKey = 'left' | 'right' | 'up' | 'down' | 'pageUp' | 'pageDown';

/** Map a KeyboardEvent.key to a MoveKey (ArrowLeft, …, PageUp, PageDown), else null. */
export function moveKeyOf(key: string): MoveKey | null {
  switch (key) {
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'PageUp': return 'pageUp';
    case 'PageDown': return 'pageDown';
    default: return null;
  }
}

/** Components whose magnitudes differ by less than this are tied. */
const TIE = 1e-6;

/** Index of the largest |v[a]| among `axes` (ties: earlier in `axes`). */
function dominant(v: Vec3, axes: readonly Axis[]): Axis {
  let best = axes[0]!;
  for (const a of axes) if (Math.abs(v[a]) > Math.abs(v[best]) + TIE) best = a;
  return best;
}

export interface ScreenAxes {
  /** World axis and sign moved by →/↑/PageUp (←/↓/PageDown are the negatives). */
  right: { axis: Axis; sign: 1 | -1 };
  up: { axis: Axis; sign: 1 | -1 };
  depth: { axis: Axis; sign: 1 | -1 };
}

/**
 * The three distinct world axes the move keys act along (§7.2 "screen-aligned grid axes"):
 * - Of `right` and `up`, the one more strongly aligned with a world axis (larger max |component|;
 *   tie → `up`) takes its dominant axis first; the other takes its dominant axis among the two
 *   remaining. Dominant-axis ties go to the lower axis index (X before Y before Z), except that
 *   `up` prefers Y on a tie.
 * - PageUp/PageDown use the remaining axis; PageUp moves toward the viewer (sign of −forward
 *   along it; + when forward is perpendicular to it).
 * - → moves along +sign(right · axis), ↑ along +sign(up · axis).
 */
export function screenAxes(cam: CameraBasis): ScreenAxes {
  const all: Axis[] = [0, 1, 2];
  const upOrder: Axis[] = [1, 0, 2];
  const mr = Math.max(...all.map((a) => Math.abs(cam.right[a])));
  const mu = Math.max(...all.map((a) => Math.abs(cam.up[a])));
  let ra: Axis;
  let ua: Axis;
  if (mu + TIE >= mr) {
    ua = dominant(cam.up, upOrder);
    ra = dominant(cam.right, all.filter((a) => a !== ua));
  } else {
    ra = dominant(cam.right, all);
    ua = dominant(cam.up, upOrder.filter((a) => a !== ra));
  }
  const da = all.find((a) => a !== ra && a !== ua)!;
  const sgn = (x: number): 1 | -1 => (x < 0 ? -1 : 1);
  const f = cam.forward[da];
  return {
    right: { axis: ra, sign: sgn(cam.right[ra]) },
    up: { axis: ua, sign: sgn(cam.up[ua]) },
    depth: { axis: da, sign: Math.abs(f) < TIE ? 1 : sgn(-f) },
  };
}

/** Integer grid delta for a move key (one cell along a world axis). See screenAxes. */
export function moveDelta(cam: CameraBasis, key: MoveKey): Vec3i {
  const s = screenAxes(cam);
  const pick = key === 'left' || key === 'right' ? s.right : key === 'up' || key === 'down' ? s.up : s.depth;
  const neg = key === 'left' || key === 'down' || key === 'pageDown';
  const d: [number, number, number] = [0, 0, 0];
  d[pick.axis] = neg ? -pick.sign : pick.sign;
  return d;
}

function fmtDelta(d: Vec3i): string {
  const parts: string[] = [];
  d.forEach((v, a) => {
    if (v !== 0) parts.push(`${v > 0 ? '+' : '−'}${Math.abs(v) === 1 ? '' : Math.abs(v)}${axisLabel(a as Axis)}`);
  });
  return parts.join(' ') || '0';
}

/**
 * Why replacing part `partId`'s cells by `cells` is invalid: the first validation message of the
 * raw result (wheel discs, §2.6, included), or null.
 */
function rawConflict(m: Model, partId: number, cells: Cell[]): string | null {
  const raw: Model = { ...m, parts: m.parts.map((p) => (p.id === partId ? { ...p, cells } : p)) };
  const e = validateModel(raw)[0];
  return e ? e.message : null;
}

/** First reason `cells` cannot be placed given the other parts (§2.3), or null. */
export function placementConflict(m: Model, cells: readonly Cell[], ignorePartId: number | null): string | null {
  for (const c of cells) {
    const others = cellsAt(m, [c.x, c.y, c.z]).filter((e) => e.partId !== ignorePartId);
    if (others.length === 0) continue;
    const at = `(${c.x}, ${c.y}, ${c.z})`;
    if (others.length >= 2) return `${at} is already shared by two parts`;
    const o = others[0]!;
    const r = shareResult(c, o.cell);
    if (!r.ok) return `${at}: ${r.reason} (part ${o.partId} has a ${kindLabel(o.cell.kind)} there)`;
  }
  return null;
}

/** Move a part by an integer delta (arrow keys / PageUp / PageDown). */
export function moveSelection(m: Model, partId: number, delta: Vec3i): OpResult {
  const part = partById(m, partId);
  if (!part) return { ok: false, message: `No part ${partId}` };
  const r = movePart(m, partId, delta);
  if (r) return { ok: true, model: r, partId, message: `Moved part ${partId} ${fmtDelta(delta)}` };
  const moved = part.cells.map((c) => makeCell(c.x + delta[0], c.y + delta[1], c.z + delta[2], c.kind, c.axis, c.rim));
  const why = placementConflict(m, moved, partId) ?? rawConflict(m, partId, moved) ?? 'the result would be invalid';
  return { ok: false, message: `Can't move part ${partId} ${fmtDelta(delta)}: ${why}` };
}

/**
 * Rotation for '[' / ']' (§7.2): the world axis most aligned with the view direction
 * (largest |forward| component; ties prefer Y, then X, then Z) and the quarter-turn sign so that
 * ']' turns the part clockwise as seen on screen. Clockwise for a viewer looking along `forward`
 * is a right-handed turn about +forward, so ']' = sign(forward[axis]) quarter turns about +axis
 * (core rotatePart is right-handed); '[' is the opposite.
 */
export function viewRotation(cam: CameraBasis, key: '[' | ']'): { axis: Axis; quarterTurns: 1 | -1 } {
  const axis = dominant(cam.forward, [1, 0, 2]);
  const cw: 1 | -1 = cam.forward[axis] < 0 ? -1 : 1;
  return { axis, quarterTurns: key === ']' ? cw : (-cw as 1 | -1) };
}

/** Rotate the selected part 90° about the view-aligned axis through its first cell. */
export function rotateSelection(m: Model, partId: number, cam: CameraBasis, key: '[' | ']'): OpResult {
  const part = partById(m, partId);
  if (!part) return { ok: false, message: `No part ${partId}` };
  const { axis, quarterTurns } = viewRotation(cam, key);
  const c0 = part.cells[0]!;
  const r = rotatePart(m, partId, axis, quarterTurns, [c0.x, c0.y, c0.z]);
  const dirWord = key === ']' ? 'clockwise' : 'counter-clockwise';
  if (r) return { ok: true, model: r, partId, message: `Rotated part ${partId} ${dirWord} about ${axisLabel(axis)}` };
  // Same cell mapping as core rotatePart, to state the real conflict (§2.3) in the status bar.
  const k = ((quarterTurns % 4) + 4) % 4;
  const rotated = part.cells.map((c) => {
    const [x, y, z] = rotateVec([c.x - c0.x, c.y - c0.y, c.z - c0.z], axis, k);
    return makeCell(x + c0.x, y + c0.y, z + c0.z, c.kind, rotateAxis(c.axis, axis, k), c.rim);
  });
  const why = placementConflict(m, rotated, partId) ?? rawConflict(m, partId, rotated) ?? 'the result would be invalid';
  return { ok: false, message: `Can't rotate part ${partId} about ${axisLabel(axis)}: ${why}` };
}

/** Default search radius (L∞, cells) of duplicateSelection. */
export const DUPLICATE_SEARCH_RADIUS = 8;

/**
 * Offsets tried by duplicateSelection, nearest first: all non-zero integer offsets with
 * max |component| <= radius, sorted by squared length, then |dy| (stay in the same layer),
 * then dx, dz, dy descending (so +X, +Z, −Z, −X, +Y, −Y for length 1).
 */
export function duplicateOffsets(radius: number): Vec3i[] {
  const out: Vec3i[] = [];
  for (let dx = -radius; dx <= radius; dx++)
    for (let dy = -radius; dy <= radius; dy++)
      for (let dz = -radius; dz <= radius; dz++) if (dx || dy || dz) out.push([dx, dy, dz]);
  const l2 = (d: Vec3i) => d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  out.sort((a, b) => l2(a) - l2(b) || Math.abs(a[1]) - Math.abs(b[1]) || b[0] - a[0] || b[2] - a[2] || b[1] - a[1]);
  return out;
}

const offsetCache = new Map<number, Vec3i[]>();

/**
 * Copy a part (same colour, wheels included) to the nearest offset where every copied cell lands
 * on an empty position (no sharing at all, so the copy never mates by accident) and its wheel
 * discs hit nothing (§2.6). Fails if none within `radius`. The result's partId is the copy.
 */
export function duplicateSelection(m: Model, partId: number, radius = DUPLICATE_SEARCH_RADIUS): OpResult {
  const part = partById(m, partId);
  if (!part) return { ok: false, message: `No part ${partId}` };
  let offsets = offsetCache.get(radius);
  if (!offsets) {
    offsets = duplicateOffsets(radius);
    offsetCache.set(radius, offsets);
  }
  // Cells the part's discs overlap (its footprint beyond its cells): a cheap pre-filter, so a wheel's
  // copy does not try every overlapping offset with the full rules.
  const disc: Vec3i[] = [];
  for (const c of part.cells) if (hasRim(c)) disc.push(...discCells([c.x, c.y, c.z], c.axis, c.rim));
  const own = new Set(part.cells.map((c) => `${c.x},${c.y},${c.z}`));
  const footprint = new Set([...own, ...disc.map((q) => `${q[0]},${q[1]},${q[2]}`)]);
  for (const d of offsets) {
    if (part.cells.some((c) => cellsAt(m, [c.x + d[0], c.y + d[1], c.z + d[2]]).length > 0)) continue;
    if (disc.length && [...footprint].some((k) => footprint.has(shiftKey(k, d)))) continue;
    const cells = part.cells.map((c) => makeCell(c.x + d[0], c.y + d[1], c.z + d[2], c.kind, c.axis, c.rim));
    let r: { model: Model; partId: number };
    try {
      r = addPart(m, cells, part.color);
    } catch {
      continue; // a disc of the copy would hit another part (or the other way round)
    }
    return { ok: true, model: r.model, partId: r.partId, message: `Duplicated part ${partId} as part ${r.partId} (offset ${fmtDelta(d)})` };
  }
  return { ok: false, message: `Can't duplicate part ${partId}: no free space within ${radius} cells` };
}

function shiftKey(k: string, d: Vec3i): string {
  const [x, y, z] = k.split(',').map(Number) as [number, number, number];
  return `${x + d[0]},${y + d[1]},${z + d[2]}`;
}

/** Delete the selected part. */
export function deleteSelection(m: Model, partId: number): OpResult {
  if (!partById(m, partId)) return { ok: false, message: `No part ${partId}` };
  return { ok: true, model: removePart(m, partId), message: `Deleted part ${partId}` };
}

export interface PartInfo {
  id: number;
  cellCount: number;
  color: string;
  isRoot: boolean;
  /** Counts per kind, e.g. { pinHole: 5 }. */
  kinds: Partial<Record<Cell['kind'], number>>;
  /** Wheel radii of the part's rims (§2.6), in cell order; absent when it has none. */
  wheels?: number[];
}

/** Inspector data for a part (§7.2), or null if it does not exist. `rootId` = effectiveRootId(m). */
export function partInfo(m: Model, partId: number, rootId: number | null): PartInfo | null {
  const p = partById(m, partId);
  if (!p) return null;
  const kinds: PartInfo['kinds'] = {};
  for (const c of p.cells) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
  const wheels = p.cells.filter(hasRim).map((c) => c.rim);
  const info: PartInfo = { id: p.id, cellCount: p.cells.length, color: p.color, isRoot: p.id === rootId, kinds };
  if (wheels.length) info.wheels = wheels;
  return info;
}
