// Item 3 follow-up: the crank web reaches beyond the nominal disc. Can a legally placed wheel of
// another part (parallel, same layer: the future gear-mesh position) have its drawn rim inside it?
// Run: npx vitest run --config spikes/review-m7/vitest.config.ts webclash
import { it } from 'vitest';
import { addPart, emptyModel, makeCell, setRim, validateModel } from '../../src/core/model';
import { buildPartMesh, initGeometry } from '../../src/geometry';
import { inside } from './meshcheck';
import { logger } from './lib';

const log = logger('webclash');

it('foreign parallel wheel vs crank web', async () => {
  await initGeometry();
  for (const [r, cu, cv] of [[1, 1, 1], [2.5, 2, 2], [3, 2, 3], [4, 2, 4], [3, 3, 2], [2, 2, 1]] as const) {
    const cells = [makeCell(0, 0, 0, 'pinHole', 2, r), makeCell(cu, cv, 0, 'pinHole', 2)];
    const mesh = buildPartMesh({ id: 1, color: '#888888', cells });
    // solid samples in the layer's mid-plane beyond the nominal disc and outside the crank's cube
    const web: [number, number][] = [];
    for (let x = -r - 1.5; x <= r + 1.5; x += 0.02)
      for (let y = -r - 1.5; y <= r + 1.5; y += 0.02) {
        if (Math.hypot(x, y) <= r) continue;
        if (Math.abs(x - cu) <= 0.5 && Math.abs(y - cv) <= 0.5) continue;
        if (Math.hypot(x, y) > r + 0.5) continue;
        if (inside(mesh, [x, y, 0])) web.push([x, y]);
      }
    let legal = 0;
    let clash = 0;
    let worst = 0;
    let ex = '';
    for (let r2 = 1; r2 <= 4; r2 += 0.5)
      for (let X = -9; X <= 9; X++)
        for (let Y = -9; Y <= 9; Y++) {
          if (Math.hypot(X, Y) > r + r2 + 1.5) continue;
          let m = addPart(emptyModel(), cells).model;
          let ok = true;
          try {
            const p = addPart(m, [makeCell(X, Y, 0, 'pinHole', 2)]);
            m = setRim(p.model, p.partId, [X, Y, 0], r2);
            ok = validateModel(m).length === 0;
          } catch { ok = false; }
          if (!ok) continue;
          legal++;
          let pen = 0;
          for (const [x, y] of web) pen = Math.max(pen, r2 - 0.03 - Math.hypot(x - X, y - Y));
          if (pen > 0) {
            clash++;
            if (pen > worst) { worst = pen; ex = `r2 ${r2} at (${X},${Y})`; }
          }
        }
    log(`r ${r} crank (${cu},${cv}): ${web.length} web samples beyond r (max ${Math.max(0, ...web.map(([x, y]) => Math.hypot(x, y) - r)).toFixed(3)}); legal foreign parallel wheels nearby ${legal}, whose drawn rim enters the web: ${clash}${clash ? `, worst ${worst.toFixed(3)} (${ex})` : ''}`);
  }
}, 1800000);
