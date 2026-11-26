// Review: wheel mass, centre of mass and axial inertia against the analytic solid disc.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ModelBuilder } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround } from '../../src/core/model';
import type { Cell } from '../../src/core/types';
import { LOGDIR, logger, make } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('mass');
it('mass', async () => {
  const cases: [string, Cell[]][] = [];
  for (const r of [1, 1.5, 2.5, 4]) cases.push([`r ${r} pin-hole hub`, [makeCell(0, 0, 0, 'pinHole', 2, r)]]);
  cases.push(['r 2.5 + crank hole (2,2)', [makeCell(0, 0, 0, 'pinHole', 2, 2.5), makeCell(2, 2, 0, 'pinHole', 2)]]);
  cases.push(['r 2.5 + crank hole (1,1)', [makeCell(0, 0, 0, 'pinHole', 2, 2.5), makeCell(1, 1, 0, 'pinHole', 2)]]);
  cases.push(['r 4 + 4 crank holes', [makeCell(0, 0, 0, 'pinHole', 2, 4), makeCell(2, 0, 0, 'pinHole', 2), makeCell(-2, 0, 0, 'pinHole', 2), makeCell(0, 2, 0, 'pinHole', 2), makeCell(0, -2, 0, 'pinHole', 2)]]);
  cases.push(['r 2.5 in the middle of a 7-beam', Array.from({ length: 7 }, (_, i) => makeCell(i - 3, 0, 0, 'pinHole', 2, i === 3 ? 2.5 : undefined))]);
  cases.push(['bare 7-beam', Array.from({ length: 7 }, (_, i) => makeCell(i - 3, 0, 0, 'pinHole', 2))]);
  for (const [name, cells] of cases) {
    const b = new ModelBuilder();
    b.add(cells);
    const m = setFixRoot(setGround(b.build(), true), false);
    const s = await make(m);
    const mi = s.massInfo(0)!;
    const r = cells[0]!.rim!;
    const R = r - 0.04;
    const mDisc = Math.PI * R * R * 0.92; // solid collision disc, density 1
    const Iz = mi.inertia[8]!;
    log(`${name}: mass ${mi.mass.toFixed(4)} (solid disc R ${R} × 0.92: ${mDisc.toFixed(4)}, ${(((mi.mass - mDisc) / mDisc) * 100).toFixed(2)} %), com ${JSON.stringify(mi.com.map((x) => +x.toFixed(4)))}, Izz ${Iz.toFixed(3)} vs ½ m R² ${(0.5 * mi.mass * R * R).toFixed(3)} (${((Iz / (0.5 * mi.mass * R * R) - 1) * 100).toFixed(2)} %)`);
    s.dispose();
  }
}, 600000);
