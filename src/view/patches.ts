// Smooth-patch labelling of a part mesh, used by the outline pass (outline.ts).
//
// buildPartMesh splits vertices at creases (dihedral ≥ 35°) and shares them across smooth edges.
// So the connected components of the "triangle shares a vertex index" relation are exactly the
// smooth surface patches (a liftarm's top face, its stadium wall, each bore wall, …). Writing the
// patch number into the id buffer makes every crease an id boundary: crease lines come out exact
// and independent of view angle or zoom (no normal threshold, no speckle on curved surfaces, no
// smear at grazing angles). Pure; no three.js.

/**
 * Patch number per vertex (0-based, dense, in order of first appearance in `indices`). Vertices not
 * referenced by any triangle get patch 0.
 */
export function vertexPatches(vertexCount: number, indices: ArrayLike<number>): { patch: Uint16Array; count: number } {
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[a] !== r) {
      const n = parent[a]!;
      parent[a] = r;
      a = n;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra < rb ? rb : ra] = ra < rb ? ra : rb;
  };
  for (let t = 0; t + 2 < indices.length; t += 3) {
    union(indices[t]!, indices[t + 1]!);
    union(indices[t]!, indices[t + 2]!);
  }
  const label = new Int32Array(vertexCount).fill(-1);
  const patch = new Uint16Array(vertexCount);
  let count = 0;
  for (let t = 0; t < indices.length; t++) {
    const r = find(indices[t]!);
    if (label[r] === -1) label[r] = count++;
  }
  for (let v = 0; v < vertexCount; v++) {
    const l = label[find(v)]!;
    // More than 65535 patches is impossible for real parts; wrap rather than throw (only the
    // inequality of neighbouring ids matters).
    patch[v] = l < 0 ? 0 : l % 65536;
  }
  return { patch, count };
}

// ---- gears: soft patches (DESIGN.md §6.1 "Gears", §4.2) ----------------------------------------

/**
 * The `surfacePatch` attribute the ID pass (outline.ts) reads: one float per vertex, the patch
 * number, NEGATIVE for a vertex of a soft patch (a gear's tooth band: the outline pass inks only its
 * true contours, and fades those that lie inside it at small zooms; see outline.ts).
 *
 * Without a hint this is exactly vertexPatches(...).patch (so a mesh without gears draws exactly as
 * before). With `hint` (MeshData.patchHint): every vertex with hint k > 0 belongs to patch
 * `count + k` (count = number of connectivity patches), whatever its connectivity, so one gear's
 * whole tooth band (split at its flank/land creases) is one patch; hint values listed in `soft`
 * (MeshData.softPatches) are stored negated. Vertices with hint 0 keep their connectivity patch.
 */
export function meshPatches(
  vertexCount: number,
  indices: ArrayLike<number>,
  hint?: ArrayLike<number>,
  soft?: readonly number[],
): Float32Array {
  const { patch, count } = vertexPatches(vertexCount, indices);
  const out = new Float32Array(patch);
  if (!hint) return out;
  const softSet = new Set(soft ?? []);
  for (let v = 0; v < vertexCount; v++) {
    const k = hint[v] ?? 0;
    if (k <= 0) continue;
    const id = (count + k) % 65536 || 65535;
    out[v] = softSet.has(k) ? -id : id;
  }
  return out;
}

/** One tooth pitch of every gear (§2.7: module ⅛, circular pitch π/8 units). */
export const TOOTH_PITCH = Math.PI / 8;
/** Contours inside a soft patch are drawn at full strength while a tooth pitch covers at least this many device px… */
export const SOFT_FULL_PX = 6;
/** …fade linearly below that, and are gone at this many device px per pitch (§6.1 "Gears"). */
export const SOFT_GONE_PX = 3;

/**
 * Strength (0…1) of the contours inside soft patches for a view in which one world unit covers
 * `devicePxPerUnit` device pixels (drawing-buffer pixels: CSS px × DPR; independent of the ID
 * buffer's supersampling, since ink width is set in device px).
 */
export function softContourFade(devicePxPerUnit: number): number {
  const px = TOOTH_PITCH * devicePxPerUnit;
  if (!(px > SOFT_GONE_PX)) return 0;
  return Math.min(1, (px - SOFT_GONE_PX) / (SOFT_FULL_PX - SOFT_GONE_PX));
}
