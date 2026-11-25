// Review: view-cube UX details. node e2e/review-view-cube.mjs -> e2e/out/review-view-cube-*.png
import { join } from 'node:path';
import { OUT_DIR, check, harness, results } from './review-view-lib.mjs';

const H = await harness();
try {
  for (const dpr of [1, 2]) {
    const c = await H.open('example=four-bar&anim=0&log=1', { width: 1000, height: 640, deviceScaleFactor: dpr });
    const p = c.page;
    const clip = { x: 1000 - 240, y: 0, width: 240, height: 140 };
    // hover each kind of region and screenshot
    for (const name of ['top', 'top-front', 'top-front-right', 'front-right']) {
      const pt = await p.evaluate((n) => window.__view.cubePoint(n), name);
      await p.mouse.move(pt[0], pt[1]);
      await p.waitForTimeout(50);
      await p.screenshot({ path: join(OUT_DIR, `review-view-cube-hover-${name}-dpr${dpr}.png`), clip });
    }
    // TOP from the default home view
    await p.evaluate(() => window.__view.home());
    const pt = await p.evaluate(() => window.__view.cubePoint('top'));
    await p.mouse.click(pt[0], pt[1]);
    const cam = await p.evaluate(() => window.__view.settle());
    await p.mouse.move(500, 600);
    await p.screenshot({ path: join(OUT_DIR, `review-view-cube-top-from-home-dpr${dpr}.png`) });
    check(`dpr${dpr}: TOP clicked from the default (home) view puts FRONT at the bottom (yaw 0)`, Math.abs(cam.yaw) < 1e-9, { yaw: cam.yaw });

    // right click on the cube must not reach the host as a scene click (index.ts: "not on cube")
    await p.evaluate(() => { window.__view.home(); window.__view.vp.renderNow(); window.__viewEvents.length = 0; });
    const fp = await p.evaluate(() => window.__view.cubePoint('front'));
    await p.mouse.click(fp[0], fp[1], { button: 'right' });
    const ev = await p.evaluate(() => window.__viewEvents.filter((e) => e.type === 'click'));
    check(`dpr${dpr}: right click on the cube is not delivered as a host click`, ev.length === 0, ev);
    // middle click too
    await p.evaluate(() => { window.__viewEvents.length = 0; });
    await p.mouse.click(fp[0], fp[1], { button: 'middle' });
    const ev2 = await p.evaluate(() => window.__viewEvents.filter((e) => e.type === 'click'));
    check(`dpr${dpr}: middle click on the cube is not delivered as a host click`, ev2.length === 0, ev2);

    // press in the widget square but off the cube silhouette (corner of the square) → orbit, not swallowed
    const r = await p.evaluate(() => { const v = window.__view.vp; return v.cube.rect(v.size.width); });
    const before = await p.evaluate(() => window.__view.camera());
    await p.mouse.move(r.x + 3, r.y + r.size - 3);
    await p.mouse.down();
    await p.mouse.move(r.x - 80, r.y + r.size + 40, { steps: 6 });
    await p.mouse.up();
    const after = await p.evaluate(() => window.__view.camera());
    check(`dpr${dpr}: drag from the empty corner of the cube square orbits`, after.yaw !== before.yaw, { before: before.yaw, after: after.yaw });
    await c.close();
  }
} finally {
  await H.done();
}
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
