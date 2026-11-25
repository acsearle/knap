import { beforeAll, describe, expect, it } from 'vitest';
import { buildPartMesh, clearMeshCache, initGeometry, liveManifoldCount, partColliders, partSolidStats } from '../../src/geometry';
import { edgeProblems, meshGenus, meshShells, meshVolume, randomPart } from './helpers';

const SEEDS = Number(process.env.GEOM_FUZZ_SEEDS ?? 400);
const MAXC = Number(process.env.GEOM_FUZZ_MAXC ?? 11);
beforeAll(() => initGeometry());

describe('random parts', () => {
  it(`${SEEDS} random valid parts (2–${MAXC + 1} cells): sound solids, meshes and colliders`, () => {
    clearMeshCache();
    const failures: string[] = [];
    const pinched: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const p = randomPart(seed, 2 + (seed % MAXC));
      try {
        const m = buildPartMesh(p);
        const raw = partSolidStats(p);
        const slow = partSolidStats(p, { fast: false });
        if (raw.status !== 'NoError') failures.push(`seed ${seed}: status ${raw.status}`);
        if (!(raw.volume > 0)) failures.push(`seed ${seed}: volume ${raw.volume}`);
        if (Math.abs(meshVolume(m) - raw.volume) > 1e-4 * raw.volume) failures.push(`seed ${seed}: mesh volume`);
        if (Math.abs(slow.volume - raw.volume) > 1e-4 * raw.volume)
          failures.push(`seed ${seed}: fast/3D volume ${raw.volume} vs ${slow.volume}`);
        for (let i = 0; i < m.normals.length; i += 3) {
          const l = Math.hypot(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!);
          if (!(Math.abs(l - 1) < 1e-5)) {
            failures.push(`seed ${seed}: bad normal`);
            break;
          }
        }
        const shells = meshShells(m);
        if (shells !== 1) failures.push(`seed ${seed}: ${shells} shells (sealed cavity?)`);
        const probs = edgeProblems(m);
        if (probs.length) pinched.push(`seed ${seed} (${p.cells.length} cells): ${probs[0]}`);
        else if (meshGenus(m) !== raw.genus) failures.push(`seed ${seed}: genus ${meshGenus(m)} vs ${raw.genus}`);
        const cols = partColliders(p);
        if (cols.filter((q) => q.shape === 'cylinder').length !== p.cells.length) failures.push(`seed ${seed}: colliders`);
      } catch (e) {
        failures.push(`seed ${seed}: threw ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
    expect(liveManifoldCount()).toBe(0);
    // Known limitation (docs/DEVIATIONS.md): where coplanar faces of differently-oriented pieces
    // meet, the boolean can leave a zero-volume pinch whose edges are shared by four triangles
    // once vertices are welded by float32 position. Manifold's own topology is still valid and
    // nothing is visible; keep the rate low so regressions show.
    if (pinched.length) console.log(`geometry fuzz: ${pinched.length}/${SEEDS} parts with pinched edges\n  ${pinched.join('\n  ')}`);
    expect(pinched.length).toBeLessThanOrEqual(Math.ceil(SEEDS * 0.01));
  }, 600000);
});
