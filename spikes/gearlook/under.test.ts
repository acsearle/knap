import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { meshClearance, type GearSpec } from './gear';
it('under', () => {
  const out: string[] = [];
  const R = [0.5, 1, 1.5, 2.5];
  for (const ub of ['radial', 'parallel'] as const) for (const B of [0.03, 0.04, 0.05]) {
    const row: string[] = [];
    for (const r1 of R) for (const r2 of R) { if (r2 < r1) continue;
      const a = { kind: 'involute', r: r1, alpha: 20 * Math.PI / 180, backlash: B, flankPts: 20, tipPts: 6, rootPts: 6, underBase: ub } as GearSpec;
      const b = { ...a, r: r2 };
      row.push(`${r1}+${r2}: ${[-0.02, 0, 0.02].map((dd) => meshClearance(a, b, r1 + r2 + dd).min.toFixed(4)).join('/')}`);
    }
    out.push(`${ub} B=${B}: ${row.join('  ')}`);
  }
  writeFileSync(__dirname + '/out/underbase.txt', out.join('\n') + '\n');
});
