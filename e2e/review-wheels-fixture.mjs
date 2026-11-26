// Review (wheels UI): a fixture model with the awkward wheel cases, opened through the real Open… button.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT_DIR } from './lib.mjs';
import { frames, settle } from './app-lib.mjs';

const C = (x, y, z, kind, axis = 2, rim) => (rim === undefined ? { x, y, z, kind, axis } : { x, y, z, kind, axis, rim });

/**
 * Part 1: 7-hole beam x 0..6 (pin holes ∥ Z, z 0).
 * Part 2: axle ∥ Z at x 0, z 0..1 (z 0 in the beam).  Part 3: wheel r 2.5 on it (axle hole (0,0,1)) + crank pin hole (1,1,1).
 * Part 4: 2-long pin in the crank hole, z 1..2.
 * Part 6: axle at x 5, z 0..1. Part 5: wheel r 2.5 on it (axle hole (5,0,1)) — touching part 3's disc (centre distance 5).
 * Part 7: loose r 1.5 wheel (pin hole (3,0,-1)) behind the beam.
 * Part 8: wheel seen edge-on from FRONT: pin hole ∥ X at (9,0,0), r 2.
 */
export const FIXTURE = {
  version: 2,
  parts: [
    { id: 1, color: '#e2b53a', cells: [0, 1, 2, 3, 4, 5, 6].map((x) => C(x, 0, 0, 'pinHole')) },
    { id: 2, color: '#a3a6a9', cells: [C(0, 0, 0, 'axle'), C(0, 0, 1, 'axle')] },
    { id: 3, color: '#3a73c8', cells: [C(0, 0, 1, 'axleHole', 2, 2.5), C(1, 1, 1, 'pinHole')] },
    { id: 4, color: '#c9b48a', cells: [C(1, 1, 1, 'pin'), C(1, 1, 2, 'pin')] },
    { id: 5, color: '#cf4a3a', cells: [C(5, 0, 1, 'axleHole', 2, 2.5)] },
    { id: 6, color: '#a3a6a9', cells: [C(5, 0, 0, 'axle'), C(5, 0, 1, 'axle')] },
    { id: 7, color: '#4c9a52', cells: [C(3, 0, -1, 'pinHole', 2, 1.5)] },
    { id: 8, color: '#5d6166', cells: [C(9, 0, 0, 'pinHole', 0, 2)] },
  ],
  rootPartId: 1,
  nextPartId: 9,
};

/** Open a model through the real Open… button (file chooser). */
export async function openModel(page, m, name = 'rw-fixture.knap.json') {
  const path = join(OUT_DIR, name);
  await writeFile(path, JSON.stringify(m, null, 1));
  const box = await page.locator('[data-action=open]').boundingBox();
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser'),
    (async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
    })(),
  ]);
  await fc.setFiles(path);
  await page.waitForFunction((n) => window.__knap.getModel().parts.length === n, m.parts.length, { timeout: 20000 }).catch(() => {});
  await frames(page, 2);
  await settle(page);
}
