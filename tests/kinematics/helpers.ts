// Shared test helpers for kinematics tests.
import { ModelBuilder } from '../../src/core/examples';
import type { KinematicGraph } from '../../src/core/kinematics';
import type { Cell, Model } from '../../src/core/types';

/** Build a model from parts in order (ids 1, 2, 3, …); optional explicit root. */
export function mk(parts: readonly (readonly Cell[])[], root?: number): Model {
  const b = new ModelBuilder();
  for (const cells of parts) b.add(cells);
  if (root !== undefined) b.root(root);
  return b.build();
}

/** Plain-data view of a graph (Map -> sorted entries) for deep equality. */
export function plain(g: KinematicGraph) {
  return {
    mates: g.mates,
    bodies: g.bodies,
    joints: g.joints,
    bodyOfPart: [...g.bodyOfPart.entries()].sort((a, b) => a[0] - b[0]),
  };
}

/** Body partition as sorted lists of part ids. */
export function partition(g: KinematicGraph): number[][] {
  return g.bodies.map((b) => b.partIds);
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(xs: readonly T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Same model with parts and each part's cells in a random order (ids unchanged). */
export function shuffleModel(m: Model, r: () => number): Model {
  return {
    ...m,
    parts: shuffled(m.parts, r).map((p) => ({ ...p, cells: shuffled(p.cells, r) })),
  };
}
