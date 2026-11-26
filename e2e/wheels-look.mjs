// Look-check helper for wheels and the ground (DESIGN §4.2 index mark, §6.1 Wheels / Ground):
//   E2E_DIST=e2e/out/ui-dist [E2E_NO_BUILD=1] [LOOK_GPU=1] node e2e/wheels-look.mjs [marks] [floor] [shadow]
// Writes e2e/out/wl-*.png (the view area only). Not a test: it asserts nothing, it is for reading.
// LOOK_GPU=1 renders on the machine's GPU (ANGLE/Metal, macOS) instead of SwiftShader; the shadow
// shots are then named wl-gpu-*.
import { chromium } from 'playwright';
import { ROOT, buildApp, launchBrowser, openPage, startServer } from './lib.mjs';
import { frames, openApp, settle } from './app-lib.mjs';

const want = new Set(process.argv.slice(2));
const all = want.size === 0;
if (!process.env.E2E_NO_BUILD) await buildApp();
const server = await startServer();
const GPU = !!process.env.LOOK_GPU;
const browser = GPU ? await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }) : await launchBrowser();
void ROOT;

const LIGHT = '#e8e8e4';
const DARK = '#5f6468';

function wheelModel(r, color, axis = 2, extra = []) {
  return {
    version: 2,
    rootPartId: null,
    nextPartId: 2 + extra.length,
    parts: [{ id: 1, color, cells: [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis, rim: r }] }, ...extra],
  };
}

async function viewShot(ctx, name) {
  const box = await ctx.page.locator('[data-role=viewport]').boundingBox();
  await ctx.shot(`wl-${name}`, { clip: box });
}

try {
  if (all || want.has('marks')) {
    for (const dpr of [1, 2]) {
      const ctx = await openPage(browser, server.url, 'wheels-look', { width: 1280, height: 720, deviceScaleFactor: dpr });
      await openApp(ctx.page, server.url);
      for (const [cls, color] of [['light', LIGHT], ['dark', DARK]]) {
        for (const r of [1, 1.5, 2.5, 4]) {
          await ctx.page.evaluate((m) => window.__knap.setModel(m), wheelModel(r, color));
          await ctx.page.evaluate(() => window.__knap.home());
          await frames(ctx.page, 2);
          await viewShot(ctx, `mark-${cls}-r${r}-home-dpr${dpr}`);
          for (const v of ['front', 'front-right', 'right', 'back']) {
            await ctx.page.evaluate((v) => {
              window.__knap.setView(v);
              window.__knap.fit();
            }, v);
            await frames(ctx.page, 2);
            await viewShot(ctx, `mark-${cls}-r${r}-${v}-dpr${dpr}`);
          }
        }
      }
      await ctx.close();
    }
  }
  if (all || want.has('floor')) {
    const ctx = await openPage(browser, server.url, 'wheels-look', { width: 1280, height: 720, deviceScaleFactor: 1 });
    await openApp(ctx.page, server.url);
    // a small cart-like model: a beam with two wheels on an axle-free hub each, ground on
    const m = {
      version: 2,
      rootPartId: null,
      nextPartId: 3,
      ground: true,
      parts: [
        { id: 1, color: '#3b74c4', cells: [0, 1, 2, 3, 4].map((x) => ({ x, y: 2, z: 0, kind: 'pinHole', axis: 2 })) },
        { id: 2, color: '#e0b43c', cells: [{ x: 0, y: 2, z: 1, kind: 'pinHole', axis: 2, rim: 1.5 }] },
      ],
    };
    await ctx.page.evaluate((m) => window.__knap.setModel(m), m);
    await ctx.page.evaluate(() => window.__knap.home());
    await frames(ctx.page, 2);
    await viewShot(ctx, 'floor-edit-home');
    for (const v of ['front', 'top', 'bottom', 'top-front-right', 'bottom-front-right']) {
      await ctx.page.evaluate((v) => window.__knap.setView(v), v);
      await frames(ctx.page, 2);
      await viewShot(ctx, `floor-edit-${v}`);
    }
    await ctx.page.evaluate(() => window.__knap.stepSim(1));
    await settle(ctx.page);
    for (const v of ['top-front-right', 'front', 'top', 'bottom-front-right']) {
      await ctx.page.evaluate((v) => window.__knap.setView(v), v);
      await frames(ctx.page, 2);
      await viewShot(ctx, `floor-sim-${v}`);
    }
    await ctx.page.evaluate(() => window.__knap.setView('top-front-right'));
    for (const [h, label] of [[3, 'zoom-in'], [400, 'far-out'], [4000, 'very-far-out']]) {
      await ctx.page.evaluate((h) => {
        const c = window.__knap.camera();
        window.__knap.setCamera({ ...c, height: h });
      }, h);
      await frames(ctx.page, 2);
      await viewShot(ctx, `floor-sim-${label}`);
    }
    // a shallow pitch (near edge-on)
    await ctx.page.evaluate(() => {
      const c = window.__knap.camera();
      window.__knap.setCamera({ ...c, height: 30, pitch: 0.06 });
    });
    await frames(ctx.page, 2);
    await viewShot(ctx, 'floor-sim-shallow');
    await ctx.close();
  }
  if (all || want.has('shadow')) {
    // The ground's contact shadow (§6.1): Cart and a beam lying on the floor, edit and simulate,
    // Home / FRONT / TOP / low three-quarter / below; the Cart mid-roll; a fixed-root pendulum on
    // the floor; zoomed out and into one wheel's contact patch; DPR 1 and 2.
    const pre = GPU ? 'gpu-' : '';
    const setCam = (page, f) => page.evaluate((f) => {
      const c = window.__knap.camera();
      window.__knap.setCamera({ ...c, ...f });
    }, f);
    for (const dpr of [1, 2]) {
      const ctx = await openPage(browser, server.url, 'wheels-look', { width: 1280, height: 720, deviceScaleFactor: dpr });
      const { page } = ctx;
      await openApp(page, server.url);
      const views = async (tag) => {
        await page.evaluate(() => window.__knap.home());
        await frames(page, 2);
        await viewShot(ctx, `${pre}shadow-${tag}-home-dpr${dpr}`);
        if (dpr === 2) return;
        for (const v of ['front', 'top', 'bottom-front-right']) {
          await page.evaluate((v) => {
            window.__knap.setView(v);
            window.__knap.fit();
          }, v);
          await frames(page, 2);
          await viewShot(ctx, `${pre}shadow-${tag}-${v}-dpr${dpr}`);
        }
        await page.evaluate(() => window.__knap.home());
        await setCam(page, { pitch: 0.28, yaw: 0.6 }); // low three-quarter (16°)
        await frames(page, 2);
        await viewShot(ctx, `${pre}shadow-${tag}-low-dpr${dpr}`);
      };
      await page.evaluate(() => window.__knap.loadExample('cart'));
      await frames(page, 2);
      await views('cart-edit');
      // one wheel's contact patch, zoomed in; the whole frame, zoomed out
      await page.evaluate(() => window.__knap.home());
      await setCam(page, { target: [0.6, -1.2, 3], height: 3.5, yaw: 0.35, pitch: 0.4 });
      await frames(page, 2);
      await viewShot(ctx, `${pre}shadow-cart-contact-dpr${dpr}`);
      await page.evaluate(() => window.__knap.home());
      await setCam(page, { height: 60 });
      await frames(page, 2);
      await viewShot(ctx, `${pre}shadow-cart-far-dpr${dpr}`);
      await page.evaluate(() => window.__knap.stepSim(0));
      await views('cart-sim');
      // mid-roll: every body pushed along +X (wheels with their rolling spin)
      const m = await page.evaluate(() => window.__knap.getModel());
      const wheels = m.parts.filter((p) => p.cells.some((c) => c.rim)).map((p) => p.id);
      await page.evaluate(([ids, w]) => ids.forEach((id) => window.__knap.pushBody(id, [5, 0, 0], w.includes(id) ? [0, 0, -5 / 1.5] : undefined)), [m.parts.map((p) => p.id), wheels]);
      await page.evaluate(() => window.__knap.stepSim(240));
      await page.evaluate(() => window.__knap.home());
      await frames(page, 2);
      await viewShot(ctx, `${pre}shadow-cart-roll-dpr${dpr}`);
      await page.evaluate(() => window.__knap.setMode('edit'));
      // a beam lying on the floor (fixed root), a loose one 1 unit up beside it (it drops when simulated)
      const beam = {
        version: 2,
        rootPartId: 1,
        nextPartId: 3,
        ground: true,
        parts: [
          { id: 1, color: '#3b74c4', cells: [0, 1, 2, 3, 4, 5, 6].map((x) => ({ x, y: 0, z: 0, kind: 'pinHole', axis: 1 })) },
          { id: 2, color: '#e0b43c', cells: [0, 1, 2, 3, 4].map((x) => ({ x, y: 1, z: 2, kind: 'pinHole', axis: 2 })) },
        ],
      };
      await page.evaluate((m) => window.__knap.setModel(m), beam);
      await frames(page, 2);
      await views('beam-edit');
      await page.evaluate(() => window.__knap.stepSim(0));
      await page.evaluate(() => window.__knap.stepSim(480));
      await views('beam-sim');
      await page.evaluate(() => window.__knap.setMode('edit'));
      // a fixed-root pendulum with the ground on: the link rests on the floor
      await page.evaluate(() => window.__knap.loadExample('pendulum'));
      await page.evaluate(() => window.__knap.setGround(true));
      await page.evaluate(() => window.__knap.stepSim(0));
      await page.evaluate(() => window.__knap.stepSim(480));
      await page.evaluate(() => window.__knap.home());
      await frames(page, 2);
      await viewShot(ctx, `${pre}shadow-pendulum-sim-dpr${dpr}`);
      await page.evaluate(() => window.__knap.setMode('edit'));
      await frames(page, 2);
      await viewShot(ctx, `${pre}shadow-pendulum-edit-dpr${dpr}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
