// Gear geometry and rule predicates (DESIGN.md §2.7). Pure; no imports outside src/core.
//
// A gear is a toothed rim: a hole cell with rim = r ∈ GEAR_RADII and teeth: true. r is the pitch
// radius (meshing, and §2.6 rule 1 connections); the tip radius r + GEAR_TIP is what blocks.
// Every test here is exact: radii are multiples of 1/32, offsets integers, and the comparisons
// are done on integers (units of 1/32 or 1/1024 for squares) — no epsilon anywhere.
import { fineDiscCellContact, fineDiscDiscContact, planeAxes } from './disc';
import type { Axis, Cell, Vec3i } from './types';

/** Pitch radii (units) a gear may have: 8, 16, 24 and 40 teeth (§2.7). */
export const GEAR_RADII: readonly number[] = Object.freeze([0.5, 1, 1.5, 2.5]);
/** Tip radius − pitch radius (units): the drawn tooth tips, used for blocking (§2.7). */
export const GEAR_TIP = 3 / 32;
/** Width of the band beyond the pitch-touch distance where two parallel gears clash: 2·GEAR_TIP. */
export const GEAR_CLASH_BAND = 2 * GEAR_TIP;
/** How far below its pitch circle a gear with a horizontal axis reaches for groundLevel (§2.7). */
export const GEAR_GROUND_EXTRA = 1 / 8;
/** Teeth per unit of pitch radius: module ⅛ unit, T = 16·r. */
export const TEETH_PER_UNIT = 16;

/** Is `r` one of GEAR_RADII? */
export function isGearRadius(r: unknown): r is number {
  return typeof r === 'number' && GEAR_RADII.includes(r);
}

/** Number of teeth of a gear of pitch radius r: 16·r (8, 16, 24, 40). Throws if r ∉ GEAR_RADII. */
export function gearTeeth(r: number): number {
  if (!isGearRadius(r)) throw new Error(`not a gear radius: ${r} (expected one of ${GEAR_RADII.join(', ')})`);
  return TEETH_PER_UNIT * r;
}

/** Tip radius r + GEAR_TIP of a gear of pitch radius r (exact: a multiple of 1/32). */
export function tipRadius(r: number): number {
  return r + GEAR_TIP;
}

/**
 * The in-plane basis (u, v) of a gear about `axis`, in world axes: (Y, Z), (Z, X), (X, Y) for
 * X, Y, Z. The ONE definition of the tooth-phase frame (§2.7); u × v = +axis. Fresh tuple.
 */
export function gearPlaneBasis(axis: Axis): [Axis, Axis] {
  return planeAxes(axis);
}

/**
 * Angle (radians) of the centre of tooth k of a gear with `teeth` teeth at rest, measured about
 * its hub from +u toward +v of gearPlaneBasis(axis): (k + ¼)·2π/T (§2.7). Tooth 0 is the index tooth.
 */
export function gearToothAngle(teeth: number, k: number): number {
  return ((k + 0.25) * 2 * Math.PI) / teeth;
}

/**
 * Is `cell` in the **web** of the gear whose hub is `gearCell` (§2.7 rule 5)? Same layer, not the
 * hub itself, axis ∥ the hub axis, and centre offset du² + dv² ≤ (r − ½)². Purely geometric:
 * the caller decides that both belong to one part. False if gearCell carries no gear radius.
 */
export function isWebCell(gearCell: Cell, cell: Cell): boolean {
  const r = gearCell.rim;
  if (!isGearRadius(r)) return false;
  const a = gearCell.axis;
  const hub = [gearCell.x, gearCell.y, gearCell.z];
  const p = [cell.x, cell.y, cell.z];
  if (p[a] !== hub[a] || cell.axis !== a) return false;
  const [u, v] = planeAxes(a);
  const du = p[u]! - hub[u]!;
  const dv = p[v]! - hub[v]!;
  if (du === 0 && dv === 0) return false;
  const k = 2 * r - 1; // (2(r − ½))², compared with 4(du² + dv²), all integers
  return 4 * (du * du + dv * dv) <= k * k;
}

/** In-plane offsets (du, dv) along gearPlaneBasis of the web cells of a gear of radius r: 0, 0, 4, 12. */
export function webOffsets(r: number): [number, number][] {
  gearTeeth(r);
  const out: [number, number][] = [];
  const k = 2 * r - 1;
  const n = Math.floor(r);
  for (let du = -n; du <= n; du++)
    for (let dv = -n; dv <= n; dv++) if ((du !== 0 || dv !== 0) && 4 * (du * du + dv * dv) <= k * k) out.push([du, dv]);
  return out;
}

/** Does the tip disc of a gear (hub, axis, pitch radius r) overlap the cell at `pos` (§2.7 rule 1)? */
export function tipOverlapsCell(hub: Vec3i, axis: Axis, r: number, pos: Vec3i): boolean {
  const c = fineDiscCellContact(hub, axis, tipRadius(r), pos);
  return c === 'partial' || c === 'full';
}

/**
 * Does the tip disc of a gear (hubG, axisG, pitch rG) overlap the disc of a plain wheel
 * (hubW, axisW, rW) (§2.7 rule 2)? Parallel or perpendicular, exact.
 */
export function tipOverlapsWheel(hubG: Vec3i, axisG: Axis, rG: number, hubW: Vec3i, axisW: Axis, rW: number): boolean {
  return fineDiscDiscContact(hubG, axisG, tipRadius(rG), hubW, axisW, rW) === 'overlap';
}

/**
 * Geometric relation of two gears (pitch radii rA, rB), §2.7 rules 3–4:
 * - 'clear'    — no interaction (different layers, far enough apart, or crossed with tips clear);
 * - 'mesh'     — parallel, same layer, hub distance exactly rA + rB, in line along a grid axis
 *                (a mesh if the gears belong to different parts);
 * - 'diagonal' — hub distance exactly rA + rB but not in line (e.g. 40+40 at (3,4)): blocked;
 * - 'clash'    — parallel, same layer, s < d < s + 3/16: the tips overlap without meshing;
 * - 'overlap'  — parallel, same layer, d < s: the pitch discs overlap;
 * - 'crossed'  — perpendicular axes and the tip discs overlap (there are no bevel gears).
 */
export type GearContact = 'clear' | 'mesh' | 'diagonal' | 'clash' | 'overlap' | 'crossed';

export function gearContact(hubA: Vec3i, axisA: Axis, rA: number, hubB: Vec3i, axisB: Axis, rB: number): GearContact {
  gearTeeth(rA);
  gearTeeth(rB);
  if (axisA !== axisB) {
    return fineDiscDiscContact(hubA, axisA, tipRadius(rA), hubB, axisB, tipRadius(rB)) === 'overlap' ? 'crossed' : 'clear';
  }
  if (hubA[axisA] !== hubB[axisA]) return 'clear';
  const [u, v] = planeAxes(axisA);
  const du = hubB[u] - hubA[u];
  const dv = hubB[v] - hubA[v];
  const S = 32 * (rA + rB); // s in 1/32 (an integer: rA, rB multiples of ½)
  const band = S + 6; // s + 3/16 in 1/32
  if (Math.abs(du) > band || Math.abs(dv) > band) return 'clear'; // keeps the squares small
  const d2 = 1024 * (du * du + dv * dv); // d² in 1/1024
  if (d2 < S * S) return 'overlap';
  if (d2 === S * S) return du === 0 || dv === 0 ? 'mesh' : 'diagonal';
  return d2 < band * band ? 'clash' : 'clear';
}
