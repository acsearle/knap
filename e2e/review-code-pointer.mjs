// Reviewer "code": a gesture whose pointerup never arrives (capture lost) keeps orbiting on plain moves
// and swallows the next press.
import { runProbes, st, sleep } from './review-code-lib.mjs';
import { frames, settle } from './app-lib.mjs';
const probes = {
  async lostPointerup({ page }) {
    await settle(page);
    const box = await page.locator('canvas').boundingBox();
    const x = box.x + 300, y = box.y + 500;
    await page.mouse.move(x, y);
    const c0 = await page.evaluate(() => window.__knap.camera());
    // real press, then the capture is lost and the release happens elsewhere (no pointerup to the canvas)
    await page.evaluate(([x, y]) => {
      const c = document.querySelector('canvas');
      c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true, pointerType: 'mouse', isPrimary: true }));
      c.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true, pointerType: 'mouse' }));
    }, [x, y]);
    // plain mouse moves, no button held
    await page.mouse.move(x + 120, y - 60, { steps: 6 });
    await frames(page, 2);
    const c1 = await page.evaluate(() => window.__knap.camera());
    // a click on a part now: is it treated as a click (selection)?
    const p = await page.evaluate(() => window.__knap.partScreenPos(1));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down(); await page.mouse.up();
    await frames(page, 1);
    const s = await st(page);
    return { yaw0: c0.yaw, yawAfterButtonlessMove: c1.yaw, selectionAfterClick: s.selection };
  },
};
await runProbes(probes);
