// View module (src/view) visual + interaction checks on the demo page e2e/view-demo.html.
//
//   npm run e2e -- view-shots            (E2E_NO_BUILD=1 to skip the app build; this script does
//                                          not use the app bundle, it serves the repo itself)
//
// Writes e2e/out/view-*.png (read them!) and asserts on camera state after real pointer gestures
// (orbit, pan ×3 ways, wheel zoom at the cursor, click vs. drag, host drag claim, view-cube
// face/edge/corner clicks, F / Home keys, Home / Fit buttons), on-demand rendering and
// setModel diffing. Prints frame times (SwiftShader software GL: CPU-bound, pessimistic).
import { OUT_DIR, openPage } from './lib.mjs';
import { startDevServer } from './geom-gallery.mjs';

// Names of src/core/examples.ts EXAMPLES (Node cannot import the TS module here).
const EXAMPLE_NAMES = ['pendulum', 'triple-pendulum', 'four-bar', 'parallelogram', 'sliding-axle', 'weld-test', 'collision'];
const ISO_PITCH = Math.atan(1 / Math.SQRT2);
const wrap = (a) => {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  else if (r > Math.PI) r -= 2 * Math.PI;
  return r;
};
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const nearAngle = (a, b, eps = 1e-3) => Math.abs(wrap(a - b)) <= eps;

export default async function (ctx) {
  const { assert, step } = ctx;
  const browser = ctx.page.context().browser();
  const server = await startDevServer();
  const pageErrors = [];
  const timings = {};

  /** Open the demo with a query; returns the lib page context. */
  async function open(query, viewport = {}) {
    const c = await openPage(browser, server.url, 'view-shots', viewport);
    await c.page.goto(`${server.url}e2e/view-demo.html?${query}`);
    await c.page.waitForFunction(() => window.__view?.ready || window.__viewError, null, { timeout: 90000 });
    const err = await c.page.evaluate(() => window.__viewError);
    assert(!err, `demo error for ${query}: ${err}`);
    return c;
  }
  async function close(c) {
    pageErrors.push(...c.errors);
    await c.close();
  }
  const cam = (c) => c.page.evaluate(() => window.__view.camera());
  const settle = (c) => c.page.evaluate(() => window.__view.settle());
  const pixels = (c) => c.page.evaluate(() => window.__view.pixelStats());
  /** Open, sanity-check the pixels, screenshot, close. */
  async function shot(file, query, viewport = {}) {
    await step(`shot ${file}`, async () => {
      const c = await open(query, viewport);
      const px = await pixels(c);
      assert(px.opaque === px.total, `${file}: drawing buffer must stay opaque (${px.total - px.opaque} translucent px)`);
      assert(px.nonBg > px.total * 0.01, `${file}: something is drawn (${px.nonBg} px)`);
      assert(px.ink > 200, `${file}: outlines are drawn (${px.ink} ink px)`);
      await c.shot(file);
      await close(c);
    });
  }

  try {
    // ------------------------------------------------------------------ screenshots
    for (const name of EXAMPLE_NAMES) await shot(`view-ex-${name}`, `example=${name}`);
    await shot('view-ex-all-tinted', 'example=all&tint=1&glyphs=1', { width: 1600, height: 600 });

    await shot('view-fourbar-front', 'example=four-bar&view=front');
    await shot('view-fourbar-top', 'example=four-bar&view=top');
    await shot('view-fourbar-right', 'example=four-bar&view=right');
    await shot('view-fourbar-odd1', 'example=four-bar&yaw=-128&pitch=-22');
    await shot('view-fourbar-odd2', 'example=four-bar&yaw=161&pitch=63');
    await shot('view-fourbar-edge', 'example=four-bar&view=top-front');

    await shot('view-closeup-pin', 'example=four-bar&target=0,2,1.4&height=2.6&yaw=32&pitch=24');
    await shot('view-closeup-pin-front', 'example=pendulum&target=0,0,0.5&height=2&view=front');
    await shot('view-closeup-stack', 'example=weld-test&target=3,0,1.5&height=3.2&yaw=58&pitch=12');
    await shot('view-closeup-bores', 'example=pendulum&target=2,0,1&height=3&yaw=20&pitch=62');
    await shot('view-closeup-axles', 'example=sliding-axle&target=4,1,0&height=4.5&yaw=-35&pitch=28');

    await shot('view-overlays', 'example=four-bar&sel=3&hoverFace=4,2,2,4&ghost=7,0,1,pinHole,2,1&glyphs=1');
    await shot('view-overlays-invalid', 'example=four-bar&sel=2,4&hoverCell=2,0,0&ghost=0,0,2,pin,2,0&glyphs=1&yaw=-30&pitch=20');
    await shot('view-overlays-tint', 'example=sliding-axle&sel=1&glyphs=1&tint=1');
    await shot('view-transform', 'example=pendulum&rot=2,-35,0,0,1,2&glyphs=1&grid=0');

    await shot('view-dpr2', 'example=four-bar&sel=3&glyphs=1', { width: 1280, height: 720, deviceScaleFactor: 2 });
    await shot('view-dpr2-closeup', 'example=four-bar&target=0,2,1.4&height=2.6&yaw=32&pitch=24', { width: 900, height: 600, deviceScaleFactor: 2 });
    await shot('view-narrow', 'example=collision', { width: 420, height: 760 });
    await shot('view-wide', 'example=triple-pendulum', { width: 1920, height: 560 });

    // ------------------------------------------------------------------ view cube
    await step('view cube hover / face / edge / corner clicks', async () => {
      const c = await open('example=four-bar&log=1', { width: 1000, height: 640, deviceScaleFactor: 2 });
      const { page } = c;
      const clip = { x: 1000 - 175, y: 0, width: 175, height: 135 };
      const pt = (name) => page.evaluate((n) => window.__view.cubePoint(n), name);
      await c.shot('view-cube-before', { clip });

      const right = await pt('right');
      assert(right, 'right face visible in iso');
      await page.mouse.move(right[0], right[1]);
      await page.waitForTimeout(50);
      await c.shot('view-cube-hover-face', { clip });
      const edge = await pt('top-right');
      assert(edge, 'top-right edge visible in iso');
      await page.mouse.move(edge[0], edge[1]);
      await page.waitForTimeout(50);
      await c.shot('view-cube-hover-edge', { clip });
      const corner = await pt('top-front-right');
      await page.mouse.move(corner[0], corner[1]);
      await page.waitForTimeout(50);
      await c.shot('view-cube-hover-corner', { clip });

      // face click
      const before = await cam(c);
      await page.mouse.click(right[0], right[1]);
      assert(await page.evaluate(() => window.__view.animating()), 'face click animates');
      let s = await settle(c);
      assert(nearAngle(s.yaw, Math.PI / 2) && near(s.pitch, 0), `face click -> right view (yaw ${s.yaw}, pitch ${s.pitch})`);
      assert(near(s.height, before.height, 1e-9) && s.target.every((v, i) => near(v, before.target[i], 1e-9)), 'face click keeps zoom and pivot');
      await page.mouse.move(500, 600);
      await c.shot('view-cube-after-face');
      await c.shot('view-cube-after-face-crop', { clip });

      // edge click from an oblique view
      await page.evaluate(() => window.__view.setCamera({ ...window.__view.camera(), yaw: (20 * Math.PI) / 180, pitch: (25 * Math.PI) / 180 }));
      await settle(c);
      await c.shot('view-cube-before-corner', { clip });
      const tfl = await pt('top-front-left');
      assert(tfl, 'top-front-left corner visible at yaw 20°, pitch 25°');
      await page.mouse.click(tfl[0], tfl[1]);
      s = await settle(c);
      assert(nearAngle(s.yaw, -Math.PI / 4) && near(s.pitch, ISO_PITCH), `corner click -> iso top-front-left (yaw ${s.yaw}, pitch ${s.pitch})`);
      await page.mouse.move(500, 600);
      await c.shot('view-cube-after-corner');
      await c.shot('view-cube-after-corner-crop', { clip });

      const tf = await pt('top-front');
      assert(tf, 'top-front edge visible');
      await page.mouse.click(tf[0], tf[1]);
      s = await settle(c);
      assert(nearAngle(s.yaw, 0) && near(s.pitch, Math.PI / 4), `edge click -> top-front 45° (yaw ${s.yaw}, pitch ${s.pitch})`);

      // top face keeps the screen rotation (nearest quarter turn)
      await page.evaluate(() => window.__view.setCamera({ ...window.__view.camera(), yaw: (100 * Math.PI) / 180, pitch: 0.5 }));
      await settle(c);
      const top = await pt('top');
      await page.mouse.click(top[0], top[1]);
      s = await settle(c);
      assert(nearAngle(s.yaw, Math.PI / 2) && near(s.pitch, Math.PI / 2), `top click keeps quarter-turn yaw (yaw ${s.yaw})`);

      const events = await page.evaluate(() => window.__viewEvents.filter((e) => e.type === 'click'));
      assert(events.length === 0, 'cube clicks are not delivered to the host as clicks');
      await close(c);
    });

    // ------------------------------------------------------------------ gestures
    await step('orbit, click, pan, zoom gestures', async () => {
      const c = await open('example=four-bar&log=1&anim=0', { width: 1000, height: 640 });
      const { page } = c;
      const events = () => page.evaluate(() => window.__viewEvents.splice(0));
      await events();

      // click: press + release with < 4 px of motion
      let a = await cam(c);
      await page.mouse.move(400, 330);
      await page.mouse.down();
      await page.mouse.move(402, 331);
      await page.mouse.up();
      let ev = (await events()).filter((e) => e.type === 'click');
      let b = await cam(c);
      assert(ev.length === 1 && ev[0].button === 0 && near(ev[0].x, 402, 1e-6) && ev[0].ray, `click delivered (${JSON.stringify(ev)})`);
      assert(nearAngle(a.yaw, b.yaw, 1e-12) && a.pitch === b.pitch, 'a click does not orbit');
      // right click is a click with button 2 (and no context menu)
      await page.mouse.click(400, 330, { button: 'right' });
      ev = (await events()).filter((e) => e.type === 'click');
      assert(ev.length === 1 && ev[0].button === 2, 'right click delivered as button 2');
      const prevented = await page.evaluate(() => {
        const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        window.__view.vp.canvas.dispatchEvent(e);
        return e.defaultPrevented;
      });
      assert(prevented, 'context menu suppressed on the canvas');

      // orbit: 120 px right, then 40 px down
      a = await cam(c);
      await page.mouse.move(400, 330);
      await page.mouse.down();
      await page.mouse.move(520, 330, { steps: 12 });
      await page.mouse.up();
      b = await cam(c);
      assert(nearAngle(b.yaw, a.yaw - 120 * 0.0085, 1e-6) && near(b.pitch, a.pitch, 1e-9), `orbit yaw (${a.yaw} -> ${b.yaw})`);
      assert(b.target.every((v, i) => near(v, a.target[i], 1e-9)) && near(b.height, a.height, 1e-9), 'orbit keeps pivot and zoom');
      ev = await events();
      assert(!ev.some((e) => e.type === 'click'), 'a drag is not a click');
      await page.mouse.move(400, 300);
      await page.mouse.down();
      await page.mouse.move(400, 340, { steps: 5 });
      await page.mouse.up();
      const c2 = await cam(c);
      assert(near(c2.pitch, b.pitch + 40 * 0.0085, 1e-6), `orbit pitch (${b.pitch} -> ${c2.pitch})`);
      // pitch clamps
      await page.mouse.move(400, 100);
      await page.mouse.down();
      await page.mouse.move(400, 600, { steps: 10 });
      await page.mouse.up();
      assert(near((await cam(c)).pitch, Math.PI / 2, 1e-12), 'pitch clamps at +90°');
      await c.shot('view-gesture-orbited');

      // pan three ways: the world point under the pointer follows it
      for (const [label, how] of [
        ['right-drag', { button: 'right' }],
        ['middle-drag', { button: 'middle' }],
        ['shift+left-drag', { button: 'left', shift: true }],
      ]) {
        await page.evaluate(() => window.__view.snap('iso'));
        const start = [300, 250];
        const delta = [140, -60];
        const ray = await page.evaluate(([x, y]) => window.__view.ray(x, y), start);
        const P = ray.origin.map((v, i) => v + ray.dir[i] * 5);
        const before = await cam(c);
        if (how.shift) await page.keyboard.down('Shift');
        await page.mouse.move(...start);
        await page.mouse.down({ button: how.button });
        await page.mouse.move(start[0] + delta[0], start[1] + delta[1], { steps: 8 });
        await page.mouse.up({ button: how.button });
        if (how.shift) await page.keyboard.up('Shift');
        const after = await cam(c);
        const p = await page.evaluate((pt) => window.__view.project(pt), P);
        assert(near(p.x, start[0] + delta[0], 0.01) && near(p.y, start[1] + delta[1], 0.01), `${label}: point follows the pointer (${p.x}, ${p.y})`);
        assert(nearAngle(after.yaw, before.yaw, 1e-12) && after.pitch === before.pitch && after.height === before.height, `${label}: pans only`);
        ev = await events();
        assert(!ev.some((e) => e.type === 'click'), `${label}: not a click`);
      }

      // wheel zoom toward the cursor
      for (const [dy, x, y] of [[-240, 700, 200], [180, 250, 500]]) {
        const before = await cam(c);
        const r0 = await page.evaluate(([px, py]) => window.__view.ray(px, py), [x, y]);
        await page.mouse.move(x, y);
        await page.mouse.wheel(0, dy);
        await page.waitForFunction((h) => window.__view.camera().height !== h, before.height);
        const after = await cam(c);
        const r1 = await page.evaluate(([px, py]) => window.__view.ray(px, py), [x, y]);
        const d = r0.origin.map((v, i) => r1.origin[i] - v);
        const t = d[0] * r0.dir[0] + d[1] * r0.dir[1] + d[2] * r0.dir[2];
        const off = Math.hypot(d[0] - t * r0.dir[0], d[1] - t * r0.dir[1], d[2] - t * r0.dir[2]);
        assert(off < 1e-6, `wheel zoom keeps the point under the cursor (off by ${off})`);
        assert(near(after.height / before.height, Math.exp(dy * 0.0015), 1e-6), `wheel zoom factor (${after.height / before.height})`);
      }
      // trackpad pinch arrives as ctrl+wheel
      {
        const before = await cam(c);
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, -20);
        await page.keyboard.up('Control');
        await page.waitForFunction((h) => window.__view.camera().height !== h, before.height);
        const after = await cam(c);
        assert(near(after.height / before.height, Math.exp(-20 * 0.01), 1e-6), `pinch zoom factor (${after.height / before.height})`);
      }

      // hover events carry rays and stop at the cube
      await events();
      await page.mouse.move(350, 350);
      await page.mouse.move(360, 352);
      ev = await events();
      assert(ev.some((e) => e.type === 'hover' && e.ray && near(e.x, 360, 1e-6)), 'hover events delivered with a ray');
      const cubePt = await page.evaluate(() => window.__view.cubePoint('front') ?? window.__view.cubePoint('top'));
      if (cubePt) {
        await page.mouse.move(cubePt[0], cubePt[1]);
        ev = await events();
        assert(ev.length > 0 && ev[ev.length - 1].type === 'hover' && Number.isNaN(ev[ev.length - 1].x), 'hover null over the view cube');
      }
      await close(c);
    });

    await step('host drag claim', async () => {
      const c = await open('example=four-bar&log=1&claim=1&anim=0', { width: 1000, height: 640 });
      const { page } = c;
      const before = await cam(c);
      await page.mouse.move(700, 300);
      await page.mouse.down();
      await page.mouse.move(760, 340, { steps: 6 });
      await page.mouse.up();
      let ev = await page.evaluate(() => window.__viewEvents.splice(0).filter((e) => e.type !== 'hover'));
      const after = await cam(c);
      assert(ev[0]?.type === 'claim' && near(ev[0].x, 700, 1e-6), `claim called with the press position (${JSON.stringify(ev[0])})`);
      assert(ev.filter((e) => e.type === 'drag').length >= 2 && ev[ev.length - 1].type === 'dragend', 'drag moves then end delivered');
      assert(nearAngle(after.yaw, before.yaw, 1e-12) && after.pitch === before.pitch, 'claimed drag does not orbit');
      await page.mouse.move(200, 300);
      await page.mouse.down();
      await page.mouse.move(260, 300, { steps: 6 });
      await page.mouse.up();
      ev = await page.evaluate(() => window.__viewEvents.splice(0).filter((e) => e.type !== 'hover'));
      assert(ev[0]?.type === 'decline' && !ev.some((e) => e.type === 'drag'), 'declined drag');
      assert(!nearAngle((await cam(c)).yaw, after.yaw, 1e-6), 'declined drag orbits');
      await close(c);
    });

    await step('keys, buttons, on-demand rendering, setModel diffing', async () => {
      const c = await open('example=four-bar&sel=3&anim=0', { width: 1000, height: 640 });
      const { page } = c;
      await page.evaluate(() => window.__view.setCamera({ target: [20, 5, 3], yaw: -2, pitch: -0.3, height: 40 }));
      await page.mouse.move(500, 400);
      await page.keyboard.press('f');
      let s = await cam(c);
      const box = await page.evaluate(() => window.__view.vp.partBox(3));
      const ctr = box.min.map((v, i) => (v + box.max[i]) / 2);
      // Fit frames the part's (float32) vertices and centres on their projected extent; for this
      // symmetric part that is its box centre up to float32 rounding.
      assert(s.target.every((v, i) => near(v, ctr[i], 1e-5)) && near(s.yaw, -2, 1e-12), `F fits the selection and keeps the orientation (${s.target})`);
      assert(s.height < 10, `F zooms to the selection (${s.height})`);
      await page.keyboard.press('Home');
      s = await cam(c);
      assert(nearAngle(s.yaw, Math.PI / 4, 1e-9) && near(s.pitch, ISO_PITCH, 1e-9), 'Home -> default isometric');
      const homeCam = s;
      await page.evaluate(() => window.__view.setCamera({ target: [9, 9, 9], yaw: 1, pitch: 0.2, height: 3 }));
      await page.click('button[aria-label^="Home"]');
      s = await cam(c);
      assert(nearAngle(s.yaw, homeCam.yaw, 1e-9) && near(s.height, homeCam.height, 1e-9), 'Home button');
      await page.evaluate(() => window.__view.vp.setSelection([]));
      await page.evaluate(() => window.__view.setCamera({ ...window.__view.camera(), target: [9, 9, 9], height: 80 }));
      await page.click('button[aria-label^="Fit"]');
      s = await cam(c);
      assert(near(s.height, homeCam.height, 1e-6), `Fit button frames everything without a selection (${s.height} vs ${homeCam.height})`);

      // on-demand rendering: idle = no frames; onFrame = continuous
      await page.mouse.move(10, 630);
      await page.waitForTimeout(150);
      const r0 = (await page.evaluate(() => window.__view.stats())).renders;
      await page.waitForTimeout(400);
      const r1 = (await page.evaluate(() => window.__view.stats())).renders;
      assert(r1 === r0, `idle viewport does not render (${r0} -> ${r1})`);
      const r2 = await page.evaluate(
        () =>
          new Promise((res) => {
            const before = window.__view.stats().renders;
            const off = window.__view.vp.onFrame(() => {});
            setTimeout(() => {
              off();
              res(window.__view.stats().renders - before);
            }, 800);
          }),
      );
      assert(r2 >= 3, `onFrame renders continuously (${r2} frames in 800 ms; SwiftShader is slow)`);

      // setModel diffing: identical parts share geometry; moves/recolours reuse it
      let st = await page.evaluate(() => window.__view.stats());
      assert(st.parts === 8 && st.geometries === 5, `four-bar: 8 parts share 5 geometries (${JSON.stringify(st)})`);
      st = await page.evaluate(() => window.__view.edit('move', 3, [0, 1, 0]));
      assert(st.geometries === 5, 'move reuses geometry');
      st = await page.evaluate(() => window.__view.edit('color', 3, '#4c9a57'));
      assert(st.geometries === 5, 'recolour reuses geometry');
      st = await page.evaluate(() => window.__view.edit('add', 2, { x: 0, y: 3, z: 1, kind: 'pinHole', axis: 2 }));
      assert(st.parts === 8 && st.geometries === 5, `changed part swaps its geometry (${JSON.stringify(st)})`);
      await c.shot('view-edited');
      await close(c);
    });

    // ------------------------------------------------------------------ stability under orbit
    await step('line stability under small orbit steps', async () => {
      const c = await open('example=four-bar&anim=0&cube=0&grid=0&root=0', { width: 900, height: 600 });
      const counts = [];
      const base = await cam(c);
      for (let i = 0; i < 12; i++) {
        await c.page.evaluate((s) => window.__view.setCamera(s), { ...base, yaw: base.yaw + (i * 0.25 * Math.PI) / 180 });
        counts.push((await pixels(c)).ink);
      }
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      const maxStep = Math.max(...counts.slice(1).map((v, i) => Math.abs(v - counts[i]) / mean));
      console.log(`  [view-shots] ink px over 0.25° steps: ${counts.join(' ')} (max step ${(maxStep * 100).toFixed(2)} %)`);
      assert(maxStep < 0.03, `ink coverage changes smoothly under orbit (max step ${(maxStep * 100).toFixed(2)} %)`);
      await close(c);
    });

    // ------------------------------------------------------------------ frame time
    await step('frame time', async () => {
      for (const [name, query, vp] of [
        ['four-bar 1280×720 DPR1', 'example=four-bar&glyphs=1&sel=3', { width: 1280, height: 720 }],
        ['all examples 1280×720 DPR1', 'example=all&glyphs=1', { width: 1280, height: 720 }],
        ['all examples 1280×720 DPR2', 'example=all&glyphs=1', { width: 1280, height: 720, deviceScaleFactor: 2 }],
      ]) {
        const c = await open(query, vp);
        const ms = await c.page.evaluate(() => window.__view.benchmark(8));
        const st = await c.page.evaluate(() => window.__view.stats());
        timings[name] = `${ms.toFixed(1)} ms/frame (${st.parts} parts, ss=${st.supersample}; SwiftShader)`;
        await close(c);
      }
      for (const [k, v] of Object.entries(timings)) console.log(`  [view-shots] frame time ${k}: ${v}`);
    });

    assert(pageErrors.length === 0, `page errors:\n    ${pageErrors.join('\n    ')}`);
    console.log(`  [view-shots] screenshots in ${OUT_DIR}/view-*.png`);
  } finally {
    await server.close();
  }
}
