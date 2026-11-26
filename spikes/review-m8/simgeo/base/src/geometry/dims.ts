// Geometric dimensions (DESIGN.md §4.1). Units are studs (1 = 8 mm). Pure constants.

/** Half-size of a cell's solid core: barrel outer radius *and* half-thickness. */
export const H = 0.47;
/** Pin-hole bore radius (also the tip radius of the cross bore). */
export const R_BORE = 0.31;
/** Half-width of each arm of the cross bore. */
export const W_BORE = 0.125;
/** Pin radius; axle tip radius. */
export const R_ROD = 0.295;
/** Half-width of each axle arm. */
export const W_ROD = 0.11;
/** Half-length of a male cell at a free (unconnected) end. */
export const E_FREE = 0.48;
/** Overlap added so touching positives fuse robustly. */
export const EPS = 0.005;

/** Extent of a connected side: half a cell plus the fusing overlap. */
export const E_CONN = 0.5 + EPS;

// ---- rendering-only detail (suggested in §4.2, not contractual) ----

/** Segments around every circle (§4.2: ≥ 48). Must be a multiple of 4 so the barrel polygon has
 *  vertices exactly on the transverse axes, where the flat web faces (at ±H) are tangent to it:
 *  a stadium's flat side then runs into its round end with no step. */
export const SEGMENTS = 48;
/** Crease angle for vertex-normal splitting, degrees. */
export const CREASE_DEG = 35;
/** Axial length (= radial depth) of the 45° chamfer on free ends of round rods (pin, frictionPin). */
export const CHAMFER = 0.03;
/** Friction-pin ridges: outer radius and tangential half-width (four ridges, at 0/90/180/270°). */
export const R_RIDGE = 0.33;
export const W_RIDGE = 0.03;

// ---- collision (§4.3) ----

/** Hole collider radius and half-length (< H, so neighbouring layers have real clearance). */
export const HC = 0.46;
/** Male collider radius. */
export const R_COLL_ROD = 0.29;

// ---- wheels (§4.2 rim, §4.3 disc) ----

/** A rim's visual radius is r − RIM_INSET (= ½ − H): the same 0.06 gap to a nominally touching neighbour as a beam. */
export const RIM_INSET = 0.5 - H;
/** Axial (= radial) size of the 45° chamfer on both edges of a rim. */
export const RIM_CHAMFER = 0.04;
/**
 * Segments around a rim of radius r (§4.2: ≥ 64 for r ≥ 2). Multiples of 4 (a vertex on each
 * transverse axis). Raised after review (the r 1.5 tread read as a polygon at 4× the Home zoom):
 * about 40 per unit of radius, so a segment is ≈ 0.16 units long at every radius.
 */
export function rimSegments(r: number): number {
  return Math.max(SEGMENTS, 4 * Math.ceil((40 * r) / 4));
}
/** Index mark (§4.2): radial groove from MARK_R0 to the edge on both flat faces, continued across the tread. */
export const MARK_R0 = 0.5;
/** Index mark groove width (tangential). */
export const MARK_W = 0.12;
/** Index mark groove depth (into each flat face, and into the tread). */
export const MARK_D = 0.04;
/** A rim's collider radius is r − RIM_COLL_INSET (= ½ − HC) (§4.3). */
export const RIM_COLL_INSET = 0.5 - HC;
