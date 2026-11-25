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
