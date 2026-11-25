// Reviewer "code": selection survives an undo that swaps in an unrelated model with the same part id.
import { runProbes, st } from './review-code-lib.mjs';
import { frames, settle } from './app-lib.mjs';
const probes = {
  async selectionAfterUndoOfExample({ page }) {
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    await settle(page);
    const p = await page.evaluate(() => window.__knap.partScreenPos(2));
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); await frames(page, 1);
    const s1 = await st(page);
    const inspector1 = await page.textContent('[data-role=inspector-sub]');
    await page.keyboard.press('Control+z'); // back to four-bar
    await frames(page, 1);
    const s2 = await st(page);
    return { selectedInPendulum: s1.selection, inspectorBefore: inspector1, afterUndoSelection: s2.selection, parts: (await page.evaluate(() => window.__knap.getModel())).parts.length,
      inspectorVisible: await page.evaluate(() => !document.querySelector('[data-role=inspector]').hidden), inspectorAfter: await page.textContent('[data-role=inspector-sub]') };
  },
};
await runProbes(probes);
