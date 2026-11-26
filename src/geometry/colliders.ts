// Collision primitives (DESIGN.md §4.3). Pure: no WASM, no three.
// Every primitive is in the part-local frame of topology.partOrigin (same frame as solid.ts).
import { DIRS, GEAR_GROUND_EXTRA, axisOfDir, isGear, isMale, isWebCell } from '../core';
import type { Axis, Cell, Dir, Part } from '../core';
import { HC, RIM_COLL_INSET, R_COLL_ROD } from './dims';
import { analyzeCells, isHub, localCenter, minusDir, partOrigin, plusDir, rodExtent } from './topology';
import type { Vec3 } from './topology';

export type { Vec3 } from './topology';

/**
 * A wheel's disc (§4.3, §5.1): one per rim, emitted *in addition to* the hub cell's ordinary
 * primitives (its cylinder and web boxes stay, exactly as for a bare hole cell).
 * - `center` = the hub cell's centre, `axis` = the hub's axis, `radius` = r − RIM_COLL_INSET
 *   (r − 0.04), `halfLength` = HC (0.46), `cell` = index of the hub in part.cells.
 * - `innerRadius` = HC: the radius of the hub's own cylinder primitive. Mass (§5.1 "Wheels"): the
 *   round collider made from this disc must carry only the annulus between the hub barrel and the
 *   rim, π·(radius² − innerRadius²)·2·halfLength at density 1, because the hub cylinder already
 *   carries its own mass. (Overlap with crank holes or other cells of the part is ignored, as §5.1
 *   says.) The hull collider has density 0.
 * - It is not an ordinary part collider: the physics layer turns it into the "round" collider
 *   (native cylinder; ground and other wheels only) and the "hull" collider (32-gon prism;
 *   ordinary part colliders only) of §5.1. `male` is always false.
 * - Picking/view: the *nominal* disc for rules and picking is radius r (`cell.rim`), one cell
 *   thick; this primitive is the collision size.
 */
export interface DiscPrim {
  shape: 'disc';
  center: Vec3;
  axis: Axis;
  radius: number;
  halfLength: number;
  innerRadius: number;
  cell: number;
  male: false;
  /**
   * Present on a gear (§2.7, §4.3): `pitch` = the pitch radius r (cell.rim). A gear's disc has
   * `radius` = r + GEAR_COLL_EXTRA (the tip radius, 0.04 inside the nominal tip r + ⅛) and
   * `innerRadius` 0: it stands for the hub and the web cells too, which yield no primitives of
   * their own inside the gear's slab (§4.3). Its mass (§5.1 "Gears") is a solid disc of the pitch
   * radius, set by the physics layer.
   */
  gear?: { pitch: number };
}

/** A gear's collider radius is r + GEAR_COLL_EXTRA = r + ⅛ − (½ − HC) = r + 0.085 (§4.3). */
export const GEAR_COLL_EXTRA = GEAR_GROUND_EXTRA - RIM_COLL_INSET;

export type ColliderPrim =
  | { shape: 'cylinder'; center: Vec3; axis: Axis; radius: number; halfLength: number; cell: number; male: boolean }
  | { shape: 'box'; center: Vec3; halfExtents: Vec3; cell: number; male: false }
  | DiscPrim;

/**
 * Compound collider of a part:
 * - hole cell → cylinder radius HC along its axis, extent ±HC, extended to ½ on axially
 *   connected sides; plus, per connected lateral face, a box from the centre to the face
 *   (half-extent ¼ along the normal, HC transversally). Holes are solid.
 * - male cell → cylinder radius R_COLL_ROD along its axis with the visual rod's extents.
 * - rim (§2.6) → additionally one DiscPrim (see its JSDoc), after the hub's own primitives.
 * - gear (§2.7, §4.3) → one DiscPrim with `gear` (see DiscPrim.gear); the hub and the web hole cells
 *   of the gear (isWebCell) yield no primitive of their own (not even their axial extensions, see
 *   below), and a web crank pin only the parts of its rod outside the slab ±HC about the gear's layer.
 * `cell` is the index into part.cells.
 */
export function partColliders(part: Part): ColliderPrim[] {
  const origin = partOrigin(part);
  const out: ColliderPrim[] = [];
  const gears = part.cells.filter((c) => isGear(c) && !isMale(c.kind));
  // Cells inside a gear's slab (§4.3): the hub and the web cells of each gear of this part.
  const slabbed = (c: Cell): boolean => gears.some((g) => g === c || isWebCell(g, c));
  for (const t of analyzeCells(part)) {
    const c = t.cell;
    const ctr = localCenter(c, origin);
    const a = c.axis;
    const inSlab = gears.length > 0 && slabbed(c);
    if (isMale(c.kind)) {
      const [lo, hi] = rodExtent(t);
      if (!inSlab) out.push(cyl(ctr, a, R_COLL_ROD, lo, hi, t.index, true));
      else for (const [l, h] of outsideSlab(lo, hi)) out.push(cyl(ctr, a, R_COLL_ROD, l, h, t.index, true));
      continue;
    }
    const hi = t.faces[plusDir(a)]!.connected ? 0.5 : HC;
    const lo = t.faces[minusDir(a)]!.connected ? -0.5 : -HC;
    if (inSlab) {
      // No cylinder and no boxes: the disc stands for the cell. Its axial extensions (HC → ½) are
      // dropped too (DEVIATIONS): they would sit face to face with a meshing partner's tip hull at
      // the slab face (an 8's hub extension lies 0.045 inside its partner's tip radius) and that
      // contact jammed a 1:5 pair. The axial neighbour's own barrel still reaches the cell face.
      void lo;
      void hi;
      if (isGear(c)) out.push({ shape: 'disc', center: [ctr[0], ctr[1], ctr[2]], axis: a, radius: c.rim + GEAR_COLL_EXTRA, halfLength: HC, innerRadius: 0, cell: t.index, male: false, gear: { pitch: c.rim } });
      continue;
    }
    out.push(cyl(ctr, a, HC, lo, hi, t.index, false));
    for (let d = 0 as Dir; d < 6; d = (d + 1) as Dir) {
      if (axisOfDir(d) === a || !t.faces[d]!.connected) continue;
      const v = DIRS[d]!;
      const n = axisOfDir(d);
      const center: Vec3 = [ctr[0] + v[0] * 0.25, ctr[1] + v[1] * 0.25, ctr[2] + v[2] * 0.25];
      const halfExtents: Vec3 = [HC, HC, HC];
      halfExtents[n] = 0.25;
      out.push({ shape: 'box', center, halfExtents, cell: t.index, male: false });
    }
    if (isHub(c)) {
      out.push({ shape: 'disc', center: [ctr[0], ctr[1], ctr[2]], axis: a, radius: c.rim - RIM_COLL_INSET, halfLength: HC, innerRadius: HC, cell: t.index, male: false });
    }
  }
  return out;
}

/** The parts of the axial extent [lo, hi] (relative to a cell centre) outside the gear slab [−HC, HC]. */
function outsideSlab(lo: number, hi: number): [number, number][] {
  const out: [number, number][] = [];
  if (lo < -HC) out.push([lo, Math.min(hi, -HC)]);
  if (hi > HC) out.push([Math.max(lo, HC), hi]);
  return out;
}

function cyl(ctr: Vec3, axis: Axis, radius: number, lo: number, hi: number, cell: number, male: boolean): ColliderPrim {
  const center: Vec3 = [ctr[0], ctr[1], ctr[2]];
  center[axis] += (lo + hi) / 2;
  return { shape: 'cylinder', center, axis, radius, halfLength: (hi - lo) / 2, cell, male };
}
