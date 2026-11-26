import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { buildPartMesh, initGeometry } from '../../src/geometry';
import Module from 'manifold-3d';
import { buildGear, type GearSpec } from './gear';
it('cost', async () => {
  await initGeometry();
  const w = await Module(); w.setup();
  const out: string[] = [];
  for (const r of [1, 1.5, 2.5]) {
    const t0 = performance.now();
    const m = buildPartMesh({ id: 1, color: '#fff', cells: [{ x: 0, y: 0, z: 0, kind: 'axleHole', axis: 2, rim: r }] });
    out.push(`wheel r${r}: ${m.indices.length / 3} tri, ${(performance.now() - t0).toFixed(1)} ms`);
  }
  for (const r of [0.5, 1, 1.5, 2.5]) {
    const spec = { kind: 'involute', r, alpha: 20 * Math.PI / 180, ha: 3 / 32, hf: 5 / 32, backlash: 0.05, underBase: 'parallel', flankPts: 5, tipPts: 2, rootPts: 2, mark: r >= 1, markTooth: true } as GearSpec;
    buildGear(w, spec);
    let ms = 0, g = buildGear(w, spec);
    for (let i = 0; i < 5; i++) { g = buildGear(w, spec); ms += g.ms; }
    out.push(`final gear r${r} N${g.info.N}: ${g.triangles} tri, ${(ms / 5).toFixed(1)} ms, closed ${g.manifoldOK}, genus ${g.genus}`);
  }
  writeFileSync(__dirname + '/out/cost.txt', out.join('\n') + '\n');
});
